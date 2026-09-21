import dotEnv from 'dotenv';
import StatusCodes from 'http-status-codes';
import moment from 'moment';
import Stripe from 'stripe';

import Subscriber from '../models/subscriberModel.js';
import Subscription from '../models/subscriptionModel.js';
import User from '../models/user.js';

import * as StripeService from '../service/stripeService.js';
import * as StripeWebhooksService from '../service/stripeWebhooksService.js';
import * as CheckoutProvisioningService from '../service/checkoutProvisioningService.js';
import { queueActivityLog } from '../utils/queueActivityLog.js';
import sendEmail from '../utils/mailGun.js';



dotEnv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const enableGlobalLogging = false;

const CHECKOUT_SUCCESS_URL = `${process.env.CLIENT_URL}/checkout-success`;
const ALLOWED_PUBLIC_REDIRECT_ORIGINS = [
  process.env.CLIENT_URL,
  process.env.CANCEL_URL,
  ...(process.env.PUBLIC_CHECKOUT_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]
  .filter(Boolean)
  .map((value) => {
    try {
      return new URL(value).origin;
    } catch (_err) {
      return null;
    }
  })
  .filter(Boolean);

const getAllowedPublicCheckoutPriceIds = () =>
  [
    process.env.SIMONE_ONETIME_PRICE,
    process.env.PRICE_BUILDER_MONTHLY,
    process.env.PRICE_BUILDER_YEARLY,
    process.env.PRICE_STUDIO_MONTHLY,
    process.env.PRICE_STUDIO_YEARLY,
  ].filter(Boolean);

const normalizeRequestedUrl = (value, fallback) => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_PUBLIC_REDIRECT_ORIGINS.includes(parsed.origin)) {
      return fallback;
    }
    return parsed.toString();
  } catch (_err) {
    return fallback;
  }
};

export const createNewSubscriber = async (req, res) => {

  if (!req.body.priceId) {
    res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: "Missing param 'priceId'",
    });
    return;
  }

  const { priceId: stripePriceId } = req.body;

  const stripeCustomerId = req.user.stripeCustomerId || await StripeService.createCustomer(req.user);
  console.log('stripeCustomerId', stripeCustomerId);
  const successUrl = req.body.successUrl || process.env.DASHBOARD_URL;
  const includeMembership =
    StripeService.isBuilderOrStudioPriceId(stripePriceId) &&
    (await StripeService.requiresMembershipFee(stripeCustomerId));
  const session = await StripeService.createCheckout(
    stripeCustomerId,
    stripePriceId,
    successUrl,
    { includeMembership }
  );
  queueActivityLog({
    req,
    userId: req.user._id,
    action: 'create',
    module: 'stripe',
    description: 'Stripe checkout session created for subscription',
    metadata: { priceId: stripePriceId, includeMembership },
  });
  return res.status(StatusCodes.CREATED).json({
      url: session.url,
    });
};

export const upgradeSubscription = async (req, res) => {
  try {
    const { subscriptionId, newPriceId } = req.body;
    
    const subscription = await StripeService.retrieveSubscription(subscriptionId);
    if (!subscription) {
      return res.status(StatusCodes.BAD_REQUEST).json({ status: 'failed', message: 'Subscription not found' });
    }
   const updatedSubscription = await StripeService.updateSubscription(subscriptionId, subscription, newPriceId, 'always_invoice', null);
   queueActivityLog({
    req,
    userId: req.user._id,
    action: 'update',
    module: 'stripe',
    description: 'Subscription upgraded',
    metadata: { subscriptionId, newPriceId },
  });
   return res.status(StatusCodes.OK).json({
    subscription: updatedSubscription,
   });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ status: 'failed', message: error.message });
  }
};

export const downgradeSubscription = async (req, res) => {
  try {
    const { subscriptionId, newPriceId } = req.body;
    const subscription = await StripeService.retrieveSubscription(subscriptionId);
    if (!subscription) {
      return res.status(StatusCodes.BAD_REQUEST).json({ status: 'failed', message: 'Subscription not found' });
    }
    const updatedSubscription = await StripeService.updateSubscription(subscriptionId, subscription, newPriceId, 'none', null);
    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'update',
      module: 'stripe',
      description: 'Subscription downgraded',
      metadata: { subscriptionId, newPriceId },
    });
    return res.status(StatusCodes.OK).json({
      subscription: updatedSubscription,
    });
  }
   catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ status: 'failed', message: error.message });
  }
};


// cancel subscription at end of billing period
export const cancelSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing param 'subscriptionId'",
      });
    }

    const subscription = await StripeService.retrieveSubscription(subscriptionId);
    if (!subscription) {
      return res.status(StatusCodes.BAD_REQUEST).json({ status: 'failed', message: 'Subscription not found' });
    }

    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;
    if (customerId !== req.user.stripeCustomerId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        status: 'failed',
        message: 'Subscription does not belong to this user',
      });
    }

    const updated = await StripeService.cancelSubscription(subscription);
    const accessEndsAt = updated?.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null;

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'delete',
      module: 'stripe',
      description: 'Subscription scheduled to cancel at period end',
      metadata: { subscriptionId, accessEndsAt, cancelAtPeriodEnd: true },
    });

    return res.status(StatusCodes.OK).json({
      status: 'success',
      message: accessEndsAt
        ? `Subscription will end on ${new Date(accessEndsAt).toLocaleDateString()}. You keep full access until then.`
        : 'Subscription will cancel at the end of your billing period. You keep full access until then.',
      cancelAtPeriodEnd: true,
      accessEndsAt,
      subscription: updated,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: error.message || 'Failed to cancel subscription',
    });
  }
};

export const pauseSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing param 'subscriptionId'",
      });
    }

    const subscription = await StripeService.retrieveSubscription(subscriptionId);
    if (!subscription) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'Subscription not found',
      });
    }

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    if (customerId !== req.user.stripeCustomerId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        status: 'failed',
        message: 'Subscription does not belong to this user',
      });
    }

    const updated = await StripeService.pauseSubscriptionToPausePlan(
      subscriptionId,
      subscription,
      req.user._id
    );

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'update',
      module: 'stripe',
      description: 'Subscription paused (pause plan)',
      metadata: {
        subscriptionId,
        pausePriceId: process.env.PAUSE_SUBSCRIPTION_PRICE,
      },
    });

    return res.status(StatusCodes.OK).json({
      status: 'success',
      message: 'Subscription paused',
      subscription: updated,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: error.message || 'Failed to pause subscription',
    });
  }
};

export const resumeSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing param 'subscriptionId'",
      });
    }

    const subscription = await StripeService.retrieveSubscription(subscriptionId);
    if (!subscription) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'Subscription not found',
      });
    }

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    if (customerId !== req.user.stripeCustomerId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        status: 'failed',
        message: 'Subscription does not belong to this user',
      });
    }

    const updated = await StripeService.resumeSubscriptionFromPausePlan(
      subscriptionId,
      subscription,
      req.user._id,
      req.user.pausedFromPriceId
    );

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'update',
      module: 'stripe',
      description: 'Subscription resumed from pause plan',
      metadata: { subscriptionId },
    });

    return res.status(StatusCodes.OK).json({
      status: 'success',
      message: 'Subscription resumed',
      subscription: updated,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: error.message || 'Failed to resume subscription',
    });
  }
};

export const getSubscription = async (req, res) => {
  try {
    const stripeCustomerId = req.user.stripeCustomerId;
    if (!stripeCustomerId) {
      return res.status(StatusCodes.OK).json({ subscription: null });
    }
    const subscription = await StripeService.getActiveSubscriptions(stripeCustomerId);
    const activePriceId = subscription?.items?.data?.[0]?.price?.id || null;
    const isPausePlan = StripeService.isPauseSubscriptionPriceId(activePriceId);
    const resumePriceId = isPausePlan
      ? subscription?.metadata?.pre_pause_price_id ||
        req.user.pausedFromPriceId ||
        null
      : null;
    const accessEndsAt = subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const isCanceledWithinPaidPeriod =
      subscription?.status === 'canceled' &&
      StripeService.isSubscriptionWithinPaidPeriod(subscription);
    const canManageSubscription = subscription
      ? ['active', 'trialing'].includes(subscription.status)
      : false;
    return res.status(StatusCodes.OK).json({
      subscription,
      isPausePlan,
      resumePriceId,
      accessEndsAt,
      canManageSubscription,
      isCanceledWithinPaidPeriod,
    });
  } catch (err) {
    console.error("getSubscription error:", err.message);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Failed to fetch subscription" });
  }
};

// Map a Stripe price id to a clean human label derived from configured env vars,
// so callers never need to render the raw `price_xxx` id.
const tierForPriceId = (priceId) => {
  if (!priceId) return null;
  if (
    priceId === process.env.PRICE_BUILDER_MONTHLY ||
    priceId === process.env.PRICE_BUILDER_YEARLY
  )
    return "Builder";
  if (
    priceId === process.env.PRICE_STUDIO_MONTHLY ||
    priceId === process.env.PRICE_STUDIO_YEARLY
  )
    return "Studio";
  return null;
};

const intervalLabelForPriceId = (priceId) => {
  if (!priceId) return null;
  if (
    priceId === process.env.PRICE_BUILDER_MONTHLY ||
    priceId === process.env.PRICE_STUDIO_MONTHLY
  )
    return "Monthly";
  if (
    priceId === process.env.PRICE_BUILDER_YEARLY ||
    priceId === process.env.PRICE_STUDIO_YEARLY
  )
    return "Yearly";
  return null;
};

export const getPriceListFromStripe = async (req, res) => {
  try {
    const priceList = await StripeService.getPriceListFromStripe();
    const priceIds = [process.env.PRICE_BUILDER_MONTHLY, process.env.PRICE_BUILDER_YEARLY, process.env.PRICE_STUDIO_MONTHLY, process.env.PRICE_STUDIO_YEARLY];
    const allowedPriceIds = new Set(priceIds.filter(Boolean));
    const sortedPriceList = priceList
      .filter((price) => allowedPriceIds.has(price.id))
      .sort((a, b) => priceIds.indexOf(a.id) - priceIds.indexOf(b.id))
      .map((price) => {
        const tier = tierForPriceId(price.id);
        const intervalLabel = intervalLabelForPriceId(price.id);
        const displayName =
          tier && intervalLabel ? `${tier} · ${intervalLabel}` : null;
        return { ...price, tier, intervalLabel, displayName };
      });

    const membership = await StripeService.getMembershipPriceDetails();
    let requiresMembershipFee = false;
    if (req.user) {
      requiresMembershipFee = await StripeService.requiresMembershipFee(
        req.user.stripeCustomerId
      );
    }

    return res.status(StatusCodes.OK).json({
      priceList: sortedPriceList,
      membership,
      requiresMembershipFee,
    });
  } catch (err) {
    console.error("getPriceListFromStripe error:", err.message);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Failed to fetch price list" });
  }
};
export const getSubscriptionV2 = async (req, res) => {
  const subscriber = await Subscriber.findOne({
    userid: req.user._id,
    subscription_status: { $in: ['active', 'trialing'] },
  });

  let subscription = null;
  if (subscriber) {
    subscription = await Subscription.findOne({ priceId: subscriber.planId });
  }

  if (!subscriber || !subscription) {
    // I'd prefer to send a 404, but axios seems to prefer 2xx codes
    res.status(StatusCodes.OK).json(null);
    return
  }

  res.status(StatusCodes.OK).json({
    subscriber: subscriber?.buildDataTransferObject(),
    subscription: subscription?.buildDataTransferObject()
  });
};

export const getAgentAccess = async (req, res) => {
  try {
    if (req.user?.role === "admin" || req.user?.role === "superadmin") {
      const simonePriceConfigured = Boolean(process.env.SIMONE_ONETIME_PRICE);
      return res.status(StatusCodes.OK).json({
        simone: true,
        simoneOneTimePaid: true,
        simonePriceConfigured,
        simoneCreditsRemaining: null,
        simonePaymentsCount: null,
        simoneKitsUsed: null,
        olivia: true,
        ellis: true,
        plan: "studio",
        subscriptionPaused: false,
        pauseCollection: null,
        isPausePlan: false,
        resumePriceId: null,
        subscriptionCancelled: false,
      });
    }

    const simonePriceId = process.env.SIMONE_ONETIME_PRICE;
    const simonePriceConfigured = Boolean(simonePriceId);
    const stripeCustomerId = req.user.stripeCustomerId;
    let activePriceId = null;
    let pauseCollection = null;
    let activeSubscription = null;
    let subscriptionCancelled = false;
    if (stripeCustomerId) {
      activeSubscription = await StripeService.getActiveSubscriptions(stripeCustomerId);
      activePriceId = activeSubscription?.items?.data?.[0]?.price?.id || null;
      pauseCollection = activeSubscription?.pause_collection || null;
      // Cancelled-only state: subscribed once, no active sub left, at least one canceled.
      // The FE uses this to lock down the app entirely except the My Account/Subscription tab.
      subscriptionCancelled =
        await StripeService.hasOnlyCancelledSubscriptions(stripeCustomerId);
    }
    const subscriptionPaused = !!pauseCollection || StripeService.isPauseSubscriptionPriceId(activePriceId);
    const isPausePlan = StripeService.isPauseSubscriptionPriceId(activePriceId);
    const resumePriceId = isPausePlan
      ? activeSubscription?.metadata?.pre_pause_price_id ||
        req.user.pausedFromPriceId ||
        null
      : null;

    const parseCsvEnv = (value) =>
      !value
        ? []
        : value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);

    const builderPlanIds = [
      process.env.PRICE_BUILDER_MONTHLY,
      process.env.PRICE_BUILDER_YEARLY,
      ...parseCsvEnv(process.env.PRICE_BUILDER_LEGACY_IDS),
    ].filter(Boolean);
    const studioPlanIds = [
      process.env.PRICE_STUDIO_MONTHLY,
      process.env.PRICE_STUDIO_YEARLY,
    ].filter(Boolean);

    const hasBuilder = builderPlanIds.includes(activePriceId);
    const hasStudio = studioPlanIds.includes(activePriceId);
    const accessEndsAt = activeSubscription?.current_period_end
      ? new Date(activeSubscription.current_period_end * 1000).toISOString()
      : null;
    let simonePaymentsCount = Number(req.user.simonePaymentsCount || 0);
    let simoneKitsUsed = Number(req.user.simoneKitsUsed || 0);
    let simoneCreditsRemaining = Number(req.user.simoneCreditsRemaining || 0);
    if (stripeCustomerId && simonePriceConfigured) {
      const observedPayments = await StripeService.countCompletedOneTimePricePurchases(
        stripeCustomerId,
        simonePriceId
      );
      if (observedPayments > simonePaymentsCount) {
        simonePaymentsCount = observedPayments;
        simoneCreditsRemaining = Math.max(0, simonePaymentsCount - simoneKitsUsed);
        await req.user.constructor.updateOne(
          { _id: req.user._id },
          {
            $set: {
              simonePaymentsCount,
              simoneCreditsRemaining,
              simoneOneTimePaid: simonePaymentsCount > 0,
              ...(simonePaymentsCount > 0 && !req.user.simoneOneTimePaidAt
                ? { simoneOneTimePaidAt: new Date() }
                : {}),
            },
          }
        );
      }
    }
    const hasSimoneOneTime = simoneCreditsRemaining > 0;

    return res.status(StatusCodes.OK).json({
      simone: hasBuilder || hasStudio || hasSimoneOneTime,
      simoneOneTimePaid: simonePaymentsCount > 0,
      simonePriceConfigured,
      simoneCreditsRemaining,
      simonePaymentsCount,
      simoneKitsUsed,
      olivia: hasBuilder || hasStudio,
      ellis: hasStudio,
      plan: hasStudio ? "studio" : hasBuilder ? "builder" : null,
      // Stripe pause_collection is non-null whenever the subscription is paused.
      // Frontend should disable agent submissions and show a "resume billing"
      // banner when subscriptionPaused === true.
      subscriptionPaused,
      pauseCollection,
      isPausePlan,
      resumePriceId,
      accessEndsAt,
      // True when the user once subscribed and every subscription is now
      // cancelled (none active). FE locks the entire app down to the My
      // Account / Subscription tab so the user can re-subscribe.
      subscriptionCancelled,
    });
  } catch (error) {
    console.error("getAgentAccess error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to check agent access",
      message: error.message,
    });
  }
};

export const createSimoneOneTimeCheckout = async (req, res) => {
  const stripePriceId = process.env.SIMONE_ONETIME_PRICE;
  if (!stripePriceId) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: "SIMONE_ONETIME_PRICE is not configured",
    });
  }

  const stripeCustomerId = req.user.stripeCustomerId || await StripeService.createCustomer(req.user);
  const successUrl = req.body.successUrl || process.env.DASHBOARD_URL;
  const session = await StripeService.createOneTimeCheckout(
    stripeCustomerId,
    stripePriceId,
    successUrl
  );

  queueActivityLog({
    req,
    userId: req.user._id,
    action: 'create',
    module: 'stripe',
    description: 'Simone one-time checkout session created',
    metadata: { priceId: stripePriceId },
  });
  return res.status(StatusCodes.CREATED).json({
    url: session.url,
  });
};

export const createPublicCheckoutSession = async (req, res) => {
  try {
    const { priceId, successUrl, cancelUrl } = req.body || {};

    if (!priceId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing 'priceId'",
      });
    }

    const allowedPriceIds = getAllowedPublicCheckoutPriceIds();
    if (!allowedPriceIds.includes(priceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'priceId is not in the allowed public checkout list',
      });
    }

    const resolvedSuccessUrl = normalizeRequestedUrl(successUrl, CHECKOUT_SUCCESS_URL);
    const resolvedCancelUrl = normalizeRequestedUrl(
      cancelUrl,
      process.env.CANCEL_URL || process.env.CLIENT_URL
    );

    const isSimoneCheckout = priceId === process.env.SIMONE_ONETIME_PRICE;
    const includeMembership =
      !isSimoneCheckout &&
      StripeService.isBuilderOrStudioPriceId(priceId) &&
      (await StripeService.requiresMembershipFee(null));

    const session = isSimoneCheckout
      ? await StripeService.createGuestOneTimeCheckout(
          priceId,
          resolvedSuccessUrl,
          { cancelUrl: resolvedCancelUrl }
        )
      : await StripeService.createGuestSubscriptionCheckout(
          priceId,
          resolvedSuccessUrl,
          {
            includeMembership,
            cancelUrl: resolvedCancelUrl,
          }
        );

    queueActivityLog({
      req,
      userId: null,
      action: 'create',
      module: 'stripe',
      description: 'Public Stripe checkout session created',
      metadata: {
        source: 'public-checkout',
        priceId,
        sessionId: session?.id,
        includeMembership,
        mode: isSimoneCheckout ? 'payment' : 'subscription',
      },
    });

    return res.status(StatusCodes.CREATED).json({
      url: session.url,
      sessionId: session.id,
      expiresAt: session.expires_at || null,
      includeMembership,
      requiresMembershipFee: includeMembership,
      mode: isSimoneCheckout ? 'payment' : 'subscription',
    });
  } catch (err) {
    console.error('createPublicCheckoutSession error:', err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: err?.message || 'Failed to create checkout session',
    });
  }
};

// Subscription plan price IDs allowed in superadmin-generated manual invite checkouts.
// One-time prices (Simone) are intentionally excluded.
const getAllowedManualInvitePriceIds = () =>
  [
    process.env.PRICE_BUILDER_MONTHLY,
    process.env.PRICE_BUILDER_YEARLY,
    process.env.PRICE_STUDIO_MONTHLY,
    process.env.PRICE_STUDIO_YEARLY,
  ].filter(Boolean);

// Superadmin generates a Stripe Checkout link on behalf of a selected user.
// The caller shares this link out-of-band; the user completes payment in Stripe Checkout.
export const createManualInviteCheckout = async (req, res) => {
  try {
    const { userId, priceId, successUrl } = req.body || {};

    if (!userId || !priceId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing 'userId' or 'priceId'",
      });
    }

    const allowedPriceIds = getAllowedManualInvitePriceIds();
    if (!allowedPriceIds.includes(priceId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'priceId is not in the allowed subscription plan list',
      });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(StatusCodes.NOT_FOUND).json({
        status: 'failed',
        message: 'User not found',
      });
    }

    if (targetUser.role === 'superadmin') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'Cannot generate invite checkout for a superadmin account',
      });
    }

    const stripeCustomerId =
      targetUser.stripeCustomerId ||
      (await StripeService.createCustomer(targetUser));

    if (!stripeCustomerId) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        status: 'failed',
        message: 'Failed to resolve or create Stripe customer for the user',
      });
    }

    const resolvedSuccessUrl = successUrl || process.env.DASHBOARD_URL;
    const includeMembership =
      StripeService.isBuilderOrStudioPriceId(priceId) &&
      (await StripeService.requiresMembershipFee(stripeCustomerId));
    const session = await StripeService.createCheckout(
      stripeCustomerId,
      priceId,
      resolvedSuccessUrl,
      { includeMembership }
    );

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'create',
      module: 'stripe',
      description: 'Superadmin generated manual invite checkout link',
      metadata: {
        targetUserId: targetUser._id?.toString(),
        targetUserEmail: targetUser.email,
        priceId,
        stripeCustomerId,
        sessionId: session?.id,
        includeMembership,
      },
    });

    return res.status(StatusCodes.CREATED).json({
      url: session.url,
      sessionId: session.id,
      expiresAt: session.expires_at || null,
      includeMembership,
      targetUser: {
        _id: targetUser._id,
        email: targetUser.email,
        fname: targetUser.fname,
        lname: targetUser.lname,
        status: targetUser.status,
      },
      priceId,
    });
  } catch (err) {
    console.error('createManualInviteCheckout error:', err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: err?.message || 'Failed to generate invite checkout link',
    });
  }
};

// Email a previously-generated checkout link to the target user via the standard mail pipeline.
// The link itself is created by createManualInviteCheckout and passed in by the admin UI.
export const sendManualInviteCheckoutEmail = async (req, res) => {
  try {
    const { userId, url, priceId } = req.body || {};

    if (!userId || !url) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: "Missing 'userId' or 'url'",
      });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(StatusCodes.NOT_FOUND).json({
        status: 'failed',
        message: 'User not found',
      });
    }

    if (!targetUser.email) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'User has no email on file',
      });
    }

    const inviterName =
      `${req.user.fname || ''} ${req.user.lname || ''}`.trim() ||
      'The StoryGroove Team';

    await sendEmail(
      targetUser.email,
      "You're invited to subscribe to StoryGroove",
      {
        name: targetUser.fname || 'there',
        checkoutUrl: url,
        inviterName,
      },
      '../utils/template/inviteCheckout.handlebars',
      false
    );

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'send',
      module: 'email',
      description: 'Superadmin sent manual invite checkout email',
      metadata: {
        targetUserId: targetUser._id?.toString(),
        targetUserEmail: targetUser.email,
        priceId: priceId || null,
      },
    });

    return res.status(StatusCodes.OK).json({
      status: 'success',
      message: `Invite email sent to ${targetUser.email}`,
    });
  } catch (err) {
    console.error('sendManualInviteCheckoutEmail error:', err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: err?.message || 'Failed to send invite email',
    });
  }
};

// create a api to create billing portal session
export const createBillingPortalSession = async (req, res) => {
  try {
    const stripeCustomerId =
      await StripeService.resolveStripeCustomerIdForUser(req.user);
    if (!stripeCustomerId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message:
          'You have never been a subscriber before. Please purchase a subscription first and then billing portal will be enabled for you',
      });
    }
    const returnUrl =
      process.env.USER_PROFILE_URL ||
      `${process.env.CLIENT_URL}/dashboard/userprofile?tab=subscription`;
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'create',
      module: 'stripe',
      description: 'Stripe billing portal session created',
      metadata: {},
    });
    return res.status(StatusCodes.OK).json({ url: session.url });
  } catch (error) {
    console.error('createBillingPortalSession error:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: error.message || 'Failed to open billing portal',
    });
  }
};

/** Safe card summary from Stripe only (brand / last4 / expiry). No PAN stored. */
export const getPaymentMethod = async (req, res) => {
  try {
    const stripeCustomerId =
      await StripeService.resolveStripeCustomerIdForUser(req.user);
    if (!stripeCustomerId) {
      return res.status(StatusCodes.OK).json({
        paymentMethod: null,
        hasStripeCustomer: false,
      });
    }
    const paymentMethod =
      await StripeService.getDefaultPaymentMethodSummary(stripeCustomerId);
    return res.status(StatusCodes.OK).json({
      paymentMethod,
      hasStripeCustomer: true,
    });
  } catch (error) {
    console.error('getPaymentMethod error:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: error.message || 'Failed to load payment method',
    });
  }
};

/** Create a SetupIntent so the browser can collect a new card via Stripe.js. */
export const createPaymentMethodSetupIntent = async (req, res) => {
  try {
    const stripeCustomerId =
      await StripeService.resolveStripeCustomerIdForUser(req.user);
    if (!stripeCustomerId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message:
          'No billing customer found. Purchase a subscription first, then update your card.',
      });
    }

    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        status: 'failed',
        message: 'STRIPE_PUBLISHABLE_KEY is not configured on the server',
      });
    }

    const setupIntent =
      await StripeService.createPaymentMethodSetupIntent(stripeCustomerId);

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'create',
      module: 'stripe',
      description: 'Payment method setup intent created',
      metadata: { setupIntentId: setupIntent.id },
    });

    return res.status(StatusCodes.OK).json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      publishableKey,
    });
  } catch (error) {
    console.error('createPaymentMethodSetupIntent error:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'failed',
      message: error.message || 'Failed to start card update',
    });
  }
};

/**
 * After Stripe.js confirms the SetupIntent, set the new payment method as
 * default and detach previous cards. Accepts only a Stripe payment_method id.
 */
export const replacePaymentMethod = async (req, res) => {
  try {
    const paymentMethodId =
      typeof req.body?.paymentMethodId === 'string'
        ? req.body.paymentMethodId.trim()
        : '';
    if (!paymentMethodId || !paymentMethodId.startsWith('pm_')) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'Valid paymentMethodId is required',
      });
    }

    const stripeCustomerId =
      await StripeService.resolveStripeCustomerIdForUser(req.user);
    if (!stripeCustomerId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        status: 'failed',
        message: 'No billing customer found',
      });
    }

    const previous =
      await StripeService.getDefaultPaymentMethodSummary(stripeCustomerId);
    const result = await StripeService.replaceDefaultPaymentMethod(
      stripeCustomerId,
      paymentMethodId
    );

    queueActivityLog({
      req,
      userId: req.user._id,
      action: 'update',
      module: 'stripe',
      description: 'Default payment method replaced',
      metadata: {
        previousBrand: previous?.brand || null,
        previousLast4: previous?.last4 || null,
        newBrand: result.paymentMethod?.brand || null,
        newLast4: result.paymentMethod?.last4 || null,
        detachedCount: result.detached?.length || 0,
        detachedLast4: (result.detached || []).map((c) => c.last4).filter(Boolean),
      },
    });

    return res.status(StatusCodes.OK).json({
      status: 'success',
      message: 'Payment method updated. Future charges will use the new card.',
      paymentMethod: result.paymentMethod,
    });
  } catch (error) {
    console.error('replacePaymentMethod error:', error);
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: 'failed',
      message: error.message || 'Failed to update payment method',
    });
  }
};

// process stripe webhooks
export const stripeWebhook = async (req, res) => {

  // TODO: Replace these with a real logging system some day
  const enableLocalLogging = false;

  let event;
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      const signature = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Error in stripeWebhook', err);
      res.status(StatusCodes.BAD_REQUEST).send(`Webhook Error: ${err.message}`);
      return;
    }
  } else {
    const raw = req.body;
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
      event = JSON.parse(raw.toString('utf8'));
    } else if (typeof raw === 'string') {
      event = JSON.parse(raw);
    } else {
      event = raw;
    }
  }

  try {
    // Handle the event
    let error_message = null;
    const errorCb = (error) => {
      error_message = error;
    };

    switch (event.type) {

      // ========== These invoice hooks save invoices for our users to review ==========

      case 'invoice.payment_succeeded': // Fall through, same logic
      case 'invoice.payment_failed':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processInvoice(event.data.object, errorCb);
        break;

      // ========== These customer hooks keep our users linked to stripe customers ==========

      // Other customer hooks not needed for now
      // case 'customer.created':
      // case 'customer.updated':
      //   break

      // This is primarily for stripe testing, but if someone deletes a customer in stripe, this also keeps un in sync
      case 'customer.deleted':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookCustomerDeleted(event.data.object);
        break;

      // ========== These subscription hooks keep our subscribers in sync with stripe ==========

      case 'customer.subscription.created': // Fall through to update, same logic
      case 'customer.subscription.updated':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookSubscriptionCreatedOrUpdated(
          event.data.object,
          errorCb
        );
        break;

      // This is primarily for stripe testing, but if someone deletes a subscription in stripe, this also keeps un in sync
      case 'customer.subscription.deleted':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookSubscriptionDeleted(
          event.data.object,
          errorCb
        );
        break;

      // ========== These price and product hooks let us manage our subscription plans via stripe ==========

      case 'price.created': // Fall through to update, same logic
      case 'price.updated':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookPriceCreatedOrUpdated(event.data.object);
        break;

      case 'price.deleted':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookPriceDeleted(event.data.object);
        break;

      case 'product.created': // Fall through to update, same logic
      case 'product.updated':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookProductCreatedOrUpdated(event.data.object);
        break;

      case 'product.deleted':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processWebhookProductDeleted(event.data.object);
        break;

      // ========== One-time payment hooks ==========
      case 'checkout.session.completed': {
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        const session = event.data.object;

        if (session?.payment_status === 'paid') {
          try {
            const provisionResult =
              await CheckoutProvisioningService.provisionUserFromCheckoutSession(
                session
              );
            if (provisionResult?.user?._id && !provisionResult.skipped) {
              console.log(
                `stripeController - checkout.session.completed: provisioned user ${provisionResult.user._id} (created=${Boolean(provisionResult.created)})`
              );
            }
          } catch (provisionErr) {
            console.error(
              'checkout.session.completed provisioning failed:',
              provisionErr.message
            );
          }
        }

        const simonePriceId = process.env.SIMONE_ONETIME_PRICE;
        if (simonePriceId && session?.mode === 'payment' && session?.customer) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
          const boughtSimone = (lineItems.data || []).some(
            (li) => li.price?.id === simonePriceId
          );
          if (boughtSimone) {
            const user = await StripeService.findUserForCustomerId(session.customer);
            if (user?._id) {
              await user.constructor.updateOne(
                { _id: user._id },
                {
                  $inc: { simonePaymentsCount: 1, simoneCreditsRemaining: 1 },
                  $set: { simoneOneTimePaid: true, simoneOneTimePaidAt: new Date() },
                }
              );
            }
          }
        }
        break;
      }

      // ========== These subscription schedule hooks are for keeping our pending changes in sync with stripe ==========

      // These schedule events we currently don't care about
      // case 'subscription_schedule.expiring':
      //   break;

      case 'subscription_schedule.created':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processScheduleCreated(event.data.object);
        break;

      case 'subscription_schedule.updated':
        if (enableGlobalLogging || enableLocalLogging) {
          const { phases, ...object } = event.data.object;
          console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, object);
          phases.forEach((phase, index) => {
            console.log(`stripeController - stripeWebhook - ${event.id} ${event.type} Phase ${index}`, phase);
          });
        }
        await StripeWebhooksService.processScheduleUpdated(event.data.object);
        break;

      // I believe these are all related to a schedule ending
      // I've only seen 'released' though...
      // case 'subscription_schedule.aborted':
      // case 'subscription_schedule.canceled':
      // case 'subscription_schedule.completed':
      case 'subscription_schedule.released':
        console.log(`stripeController - stripeWebhook - ${event.id} ${event.type}`, event.data.object);
        await StripeWebhooksService.processScheduleReleaedOrDeleted(event.data.object);
        break;

      default:
        // We can leave this one always on
        console.log(`stripeController - stripeWebhook - Unhandled event type ${event.type}, id ${event.id}`);
    }

    if (error_message) {
      console.error(error_message);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error_message });
      return;
    }

    res.status(StatusCodes.OK).json({ received: true });
  } catch (err) {
    console.error('stripeWebhook - unhandled error', err);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: err?.message ?? 'Webhook processing failed',
      });
    }
  }
};
