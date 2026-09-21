import crypto from "crypto";
import dotEnv from "dotenv";
import Stripe from "stripe";

import CheckoutProvision from "../models/checkoutProvisionModel.js";
import User from "../models/user.js";
import { sendVerificationEmail } from "../utils/mailGun.js";
import * as StripeService from "./stripeService.js";

dotEnv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Checkout signups receive a single verification email they cannot request again from
// the checkout flow, so the link has to survive longer than a browsing session.
const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000;

const parseNameFromStripe = (rawName, email) => {
  const trimmed = String(rawName || "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    const fname = parts[0] || "Member";
    const lname = parts.slice(1).join(" ") || "Member";
    return { fname, lname };
  }
  const local = String(email || "").split("@")[0] || "Member";
  const cleaned = local.replace(/[^a-zA-Z]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return {
    fname: parts[0] || "Member",
    lname: parts.slice(1).join(" ") || "Member",
  };
};

const resolveEmailForCustomer = async (stripeCustomerId, session = null) => {
  const fromSession =
    session?.customer_details?.email || session?.customer_email || null;
  if (fromSession) return String(fromSession).trim().toLowerCase();

  if (!stripeCustomerId) return null;

  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer?.deleted) return null;
  return customer.email ? String(customer.email).trim().toLowerCase() : null;
};

const issueVerificationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    expires: new Date(Date.now() + VERIFICATION_TTL_MS),
  };
};

/** True while an already-emailed verification link is still usable. */
const hasPendingVerification = (user) => {
  const pending = user.verificationToken;
  if (!pending?.token || !pending?.expires) return false;
  return new Date(pending.expires).getTime() > Date.now();
};

const recordProvision = async (sessionId, userId) => {
  if (!sessionId) return;
  await CheckoutProvision.findOneAndUpdate(
    { sessionId },
    { userId },
    { upsert: true, new: true }
  );
};

const sendUserVerificationEmail = async (user) => {
  const { token: verificationString, expires } = issueVerificationToken();
  user.verificationToken = { token: verificationString, expires };
  await user.save();

  const verifyLink = `${process.env.CLIENT_URL}/verify/${verificationString}`;
  await sendVerificationEmail({
    email: user.email,
    name: user.fname,
    verifyLink,
  });
  user.verificationEmailSentAt = new Date();
  await user.save();
};

const linkStripeCustomer = async (user, stripeCustomerId) => {
  if (!stripeCustomerId) return user;
  if (user.stripeCustomerId === stripeCustomerId) return user;
  user.stripeCustomerId = stripeCustomerId;
  return user.save();
};

/**
 * Core provisioning: find or create a User for a Stripe customer email.
 */
export const provisionUserForStripeCustomer = async ({
  stripeCustomerId,
  email,
  name,
  sessionId = null,
}) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Cannot provision user without email");
  }

  let user =
    (stripeCustomerId
      ? await User.findOne({ stripeCustomerId })
      : null) || (await User.findOne({ email: normalizedEmail }));

  const { fname, lname } = parseNameFromStripe(name, normalizedEmail);

  if (user) {
    await linkStripeCustomer(user, stripeCustomerId);
    await recordProvision(sessionId, user._id);

    if (user.status === "active") {
      return { user, created: false, verificationEmailSent: false };
    }

    if (user.signupType !== "stripe_checkout") {
      user.signupType = "stripe_checkout";
    }
    user.passwordSetupRequired = true;
    await user.save();

    // checkout.session.completed and customer.subscription.created both provision, so
    // resending here would invalidate the link the user already has in their inbox.
    if (hasPendingVerification(user)) {
      return { user, created: false, verificationEmailSent: false };
    }

    await sendUserVerificationEmail(user);
    return { user, created: false, verificationEmailSent: true };
  }

  const randomPassword = crypto.randomBytes(32).toString("hex");

  try {
    user = await User.create({
      fname,
      lname,
      username: normalizedEmail,
      email: normalizedEmail,
      password: randomPassword,
      role: "user",
      status: "inactive",
      signupType: "stripe_checkout",
      passwordSetupRequired: true,
      stripeCustomerId: stripeCustomerId || null,
    });
  } catch (err) {
    // A concurrent webhook won the race; reuse its account instead of emailing twice.
    if (err?.code === 11000) {
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        await linkStripeCustomer(existing, stripeCustomerId);
        await recordProvision(sessionId, existing._id);
        return { user: existing, created: false, verificationEmailSent: false };
      }
    }
    throw err;
  }

  await sendUserVerificationEmail(user);
  await recordProvision(sessionId, user._id);

  return { user, created: true, verificationEmailSent: true };
};

/**
 * Idempotent user provisioning from checkout.session.completed.
 */
export const provisionUserFromCheckoutSession = async (session) => {
  if (!session?.id) {
    return { skipped: true, reason: "missing_session" };
  }
  if (session.payment_status !== "paid") {
    return { skipped: true, reason: "not_paid" };
  }

  const existingProvision = await CheckoutProvision.findOne({
    sessionId: session.id,
  });
  if (existingProvision) {
    const user = await User.findById(existingProvision.userId);
    return { user, created: false, idempotent: true, verificationEmailSent: false };
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const email = await resolveEmailForCustomer(stripeCustomerId, session);
  if (!email) {
    throw new Error(
      `checkout.session.completed ${session.id}: no email on session or customer`
    );
  }

  let customerName = session.customer_details?.name || null;
  if (!customerName && stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      if (!customer.deleted) customerName = customer.name || null;
    } catch (_err) {
      // non-fatal
    }
  }

  return provisionUserForStripeCustomer({
    stripeCustomerId,
    email,
    name: customerName,
    sessionId: session.id,
  });
};

/**
 * Fallback when subscription webhook arrives before checkout.session.completed.
 */
export const provisionUserFromStripeCustomer = async (stripeCustomerId) => {
  if (!stripeCustomerId) {
    throw new Error("Missing stripeCustomerId for provisioning fallback");
  }

  const existing = await StripeService.findUserForCustomerId(stripeCustomerId);
  if (existing) {
    return { user: existing, created: false, verificationEmailSent: false };
  }

  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer?.deleted || !customer.email) {
    throw new Error(
      `Cannot provision user for customer ${stripeCustomerId}: missing email`
    );
  }

  return provisionUserForStripeCustomer({
    stripeCustomerId,
    email: customer.email,
    name: customer.name,
  });
};
