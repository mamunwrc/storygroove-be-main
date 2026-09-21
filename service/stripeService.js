import dotEnv from 'dotenv';
import Stripe from 'stripe';

import Subscriber from '../models/subscriberModel.js';
import Subscription from '../models/subscriptionModel.js';
import User from '../models/user.js';



dotEnv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// We have a customerId, try to find a user
export const findUserForCustomerId = async (stripeCustomerId) => {
  // Lets try to find our user
  let existingUser = await User.findOne({stripeCustomerId});

  if (existingUser) {
    return existingUser;
  }

  // Do we have an existing subscriber we can reference to find the user?
  const existingSubscriber = await Subscriber.findOne({customer_id: stripeCustomerId});

  if (existingSubscriber) {
    existingUser = await User.findById(existingSubscriber.userid);
  } else {
    // Alright, try to find them using the stripe customer data
    const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);

    // Do we have a regular user?
    existingUser = await User.findOne({email: stripeCustomer.email});

    if (!existingUser) {
      // What about a Shopify user?
      existingUser = await User.findOne({shopifyURL: stripeCustomer.email});
    }
  }

  if (existingUser) {
    // Alright, save this ID for future use
    existingUser.stripeCustomerId = stripeCustomerId;
    existingUser = await existingUser.save();
  }

  // Return the existingUser, or null
  return existingUser;
}

export const createCustomer = async (user) => {
  try {
  const stripeCustomer = await stripe.customers.create({
    email: user.email,
    name: user.fname + ' ' + user.lname,
  });
  user.stripeCustomerId = stripeCustomer.id;
  await user.save();
} catch (error) {
  console.error(`Couldn't create customer for ${user.email} (ID: ${user._id})`, error);
  return null;
}
return user.stripeCustomerId;
}

export const registerForFreePlan = async (user) => {
  // register user for free plan
  if (process.env.STRIPE_DEFAULT_PLAN_PRICE_ID) {
    const stripeCustomerId = await getFindOrCreateCustomerIdForUser(user);
    const stripePriceId = process.env.STRIPE_DEFAULT_PLAN_PRICE_ID;
    try {
      await createSubscription(stripeCustomerId, stripePriceId);
    } catch (error) {
      console.error(`Couldn't sign up ${user.email} (ID: ${user._id}) for the default plan!`, error);
    }
  }
}

// Note that this attempts to put someone on a plan, but if there's no credit card on file, it'll eventually cancel due to being unable to bill
// So `createCheckout` is prefered, but this can let us silently put someone on a free plan
export const createSubscription = async (stripeCustomerId, stripePriceId) => {
  return await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [
      {
        price: stripePriceId,
      },
    ],
  });
}

/** Builder + Studio subscription price IDs (current env + legacy Builder). */
export const getBuilderStudioPriceIds = () => {
  const legacyBuilder = (process.env.PRICE_BUILDER_LEGACY_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    process.env.PRICE_BUILDER_MONTHLY,
    process.env.PRICE_BUILDER_YEARLY,
    process.env.PRICE_STUDIO_MONTHLY,
    process.env.PRICE_STUDIO_YEARLY,
    ...legacyBuilder,
  ].filter(Boolean);
};

export const isBuilderOrStudioPriceId = (priceId) => {
  if (!priceId) return false;
  return getBuilderStudioPriceIds().includes(priceId);
};

export const getPauseSubscriptionPriceId = () =>
  process.env.PAUSE_SUBSCRIPTION_PRICE || null;

export const isPauseSubscriptionPriceId = (priceId) => {
  const pausePriceId = getPauseSubscriptionPriceId();
  return Boolean(pausePriceId && priceId === pausePriceId);
};

/** Active subscription price IDs: Builder, Studio (incl. legacy), and pause plan. */
export const getAllowedSubscriptionPriceIds = () => {
  const pausePriceId = getPauseSubscriptionPriceId();
  return [
    ...getBuilderStudioPriceIds(),
    ...(pausePriceId ? [pausePriceId] : []),
  ];
};

/** Subscription statuses that do not count as ever having held Builder/Studio (failed/abandoned checkout). */
const INCOMPLETE_SUBSCRIPTION_STATUSES = new Set([
  'incomplete',
  'incomplete_expired',
]);

/**
 * True when the customer has ever held a Builder or Studio subscription
 * (any status except incomplete / incomplete_expired from failed checkout).
 * Legacy Builder price IDs count so long-time customers are
 * never charged the new membership fee.
 */
export const hasEverSubscribedBuilderOrStudio = async (stripeCustomerId) => {
  if (!stripeCustomerId) return false;
  const priceIds = new Set(getBuilderStudioPriceIds());
  const result = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: 'all',
    limit: 100,
  });
  const matchingSubs = (result?.data || []).filter((sub) =>
    priceIds.has(sub.items?.data?.[0]?.price?.id)
  );
  const qualifyingSubs = matchingSubs.filter(
    (sub) => !INCOMPLETE_SUBSCRIPTION_STATUSES.has(sub.status)
  );
  return qualifyingSubs.length > 0;
};

/**
 * New Builder/Studio buyers pay MEMBERSHIP_PRICE once at first checkout.
 * Existing customers (prior Builder/Studio sub or already paid membership)
 * are exempt. Simone-only buyers are not exempt until they pick Builder/Studio.
 */
export const requiresMembershipFee = async (stripeCustomerId) => {
  const membershipPriceId = process.env.MEMBERSHIP_PRICE;
  if (!membershipPriceId) return false;
  if (!stripeCustomerId) return true;

  const [everSubscribed, alreadyPaidMembership] = await Promise.all([
    hasEverSubscribedBuilderOrStudio(stripeCustomerId),
    hasCompletedOneTimePrice(stripeCustomerId, membershipPriceId),
  ]);

  return !everSubscribed && !alreadyPaidMembership;
};

export const getMembershipPriceDetails = async () => {
  const membershipPriceId = process.env.MEMBERSHIP_PRICE;
  if (!membershipPriceId) return null;
  try {
    const price = await stripe.prices.retrieve(membershipPriceId);
    return {
      priceId: membershipPriceId,
      amount: Number((price.unit_amount || 0) / 100),
      currency: price.currency || 'usd',
      displayName: 'Membership fee',
      billingType: 'one_time',
    };
  } catch (error) {
    console.error('getMembershipPriceDetails error:', error.message);
    return null;
  }
};

export const createCheckout = async (
  stripeCustomerId,
  stripePriceId,
  successUrl,
  options = {}
) => {
  const lineItems = [{ price: stripePriceId, quantity: 1 }];
  const membershipPriceId = process.env.MEMBERSHIP_PRICE;
  const includeMembership =
    options.includeMembership &&
    membershipPriceId &&
    isBuilderOrStudioPriceId(stripePriceId);

  if (includeMembership) {
    lineItems.push({ price: membershipPriceId, quantity: 1 });
  }

  return await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: options.cancelUrl || process.env.CANCEL_URL,
    line_items: lineItems,
    allow_promotion_codes: true,
    mode: 'subscription',
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    custom_text: {
      submit: {
        message: includeMembership
          ? 'I agree to the Terms of Service. The membership fee is a one-time charge; your subscription renews based on your billing frequency and is non-refundable.'
          : 'I agree to the Terms of Service and understand that subscriptions are non-refundable',
      },
    },
  });
};

export const createOneTimeCheckout = async (stripeCustomerId, stripePriceId, successUrl) => {
  return await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: process.env.CANCEL_URL,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    allow_promotion_codes: true,
    mode: 'payment',
    customer: stripeCustomerId,
    payment_method_types: ['card'],
  });
};

/**
 * Landing-page checkout: Stripe collects email and creates the customer at payment time.
 */
export const createGuestSubscriptionCheckout = async (
  stripePriceId,
  successUrl,
  options = {}
) => {
  const lineItems = [{ price: stripePriceId, quantity: 1 }];
  const membershipPriceId = process.env.MEMBERSHIP_PRICE;
  const includeMembership =
    options.includeMembership &&
    membershipPriceId &&
    isBuilderOrStudioPriceId(stripePriceId);

  if (includeMembership) {
    lineItems.push({ price: membershipPriceId, quantity: 1 });
  }

  return await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: options.cancelUrl || process.env.CANCEL_URL,
    line_items: lineItems,
    allow_promotion_codes: true,
    mode: 'subscription',
    payment_method_types: ['card'],
    custom_text: {
      submit: {
        message: includeMembership
          ? 'I agree to the Terms of Service. The membership fee is a one-time charge; your subscription renews based on your billing frequency and is non-refundable.'
          : 'I agree to the Terms of Service and understand that subscriptions are non-refundable',
      },
    },
  });
};

export const createGuestOneTimeCheckout = async (
  stripePriceId,
  successUrl,
  options = {}
) => {
  return await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: options.cancelUrl || process.env.CANCEL_URL,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    allow_promotion_codes: true,
    mode: 'payment',
    customer_creation: 'always',
    payment_method_types: ['card'],
  });
};

/**
 * Check whether a Stripe customer has completed a one-time Checkout for a given price.
 * Uses Checkout Sessions because one-time payments don't appear in subscriptions.
 */
export const hasCompletedOneTimePrice = async (stripeCustomerId, stripePriceId) => {
  const count = await countCompletedOneTimePricePurchases(stripeCustomerId, stripePriceId);
  return count > 0;
};

/**
 * Count paid one-time checkout sessions for a specific customer + price.
 * Each completed payment is treated as one Simone credit.
 */
export const countCompletedOneTimePricePurchases = async (stripeCustomerId, stripePriceId) => {
  if (!stripeCustomerId || !stripePriceId) return 0;
  let startingAfter = null;
  // Limit scan breadth; this is only used as a fallback/backfill path.
  const MAX_PAGES = 5;
  let count = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sessions = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const session of sessions.data || []) {
      if (session.mode !== 'payment' || session.payment_status !== 'paid') continue;
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      const hasPrice = (lineItems.data || []).some(
        (li) => li.price?.id === stripePriceId
      );
      if (hasPrice) count += 1;
    }

    if (!sessions.has_more || !sessions.data?.length) break;
    startingAfter = sessions.data[sessions.data.length - 1].id;
  }
  return count;
};

export const retrieveSubscription = async (subscriptionId) => {
  return await stripe.subscriptions.retrieve(subscriptionId);
}

export const updateSubscription = async (subscriptionId, currentStripeSubscription, newPriceId, prorationBehavior = 'always_invoice', billingCycleAnchor = null) => {
  const updateData = {
    items: [{ 
      id: currentStripeSubscription.items.data[0].id,
      price: newPriceId,
    }],
    proration_behavior: prorationBehavior
  }
  if (billingCycleAnchor) {
    updateData.billing_cycle_anchor = billingCycleAnchor;
  }
  return await stripe.subscriptions.update(subscriptionId, updateData);
}

// Schedule cancellation at period end — user keeps access until current_period_end.
export const cancelSubscription = async (subscription) => {
  return await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
  });
};

const nowInSeconds = () => Math.floor(Date.now() / 1000);

/**
 * True when the subscription's invoiced period has not ended yet.
 * Used for canceled subs (incl. legacy immediate cancels) that should
 * retain access through the billing cycle the customer already paid for.
 */
export const isSubscriptionWithinPaidPeriod = (subscription) => {
  const periodEnd = subscription?.current_period_end;
  if (!periodEnd) return false;
  return periodEnd > nowInSeconds();
};

/**
 * True when a Builder/Studio/pause subscription should grant product access.
 * Active/trialing subs always qualify; canceled subs qualify only while still
 * inside current_period_end (paid-through date).
 */
export const subscriptionGrantsEntitlement = (subscription) => {
  if (!subscription) return false;
  if (['active', 'trialing'].includes(subscription.status)) return true;
  if (subscription.status === 'canceled') {
    return isSubscriptionWithinPaidPeriod(subscription);
  }
  return false;
};

const listCustomerSubscriptions = async (stripeCustomerId) => {
  const result = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: 'all',
    limit: 100,
  });
  return result?.data || [];
};

/**
 * Returns true iff the user has subscribed at least once but currently has
 * no entitled subscription left (no active/trialing and no canceled sub still
 * inside its paid period).
 *
 * Queries Stripe directly (no local Subscriber lookup) so the decision is
 * always against the source of truth — webhook lag or missed events won't
 * incorrectly lock anyone out or let a cancelled user back in.
 *
 * Cases that intentionally return false:
 *  - User has no Stripe customer (they never subscribed).
 *  - Customer exists but has no subscriptions on record.
 *  - User has any active/trialing subscription right now (incl. paused via
 *    pause_collection, which Stripe keeps as status "active", and cancel-
 *    at-period-end users still inside their cycle).
 *  - A canceled subscription is still within current_period_end (paid period).
 *  - Only non-terminal failure states (past_due, incomplete, unpaid,
 *    incomplete_expired) and nothing cancelled yet — they may still recover.
 */
export const hasOnlyCancelledSubscriptions = async (stripeCustomerId) => {
  if (!stripeCustomerId) return false;

  const subs = await listCustomerSubscriptions(stripeCustomerId);
  if (subs.length === 0) return false;

  const hasEntitled = subs.some((s) => subscriptionGrantsEntitlement(s));
  if (hasEntitled) return false;

  const hasCancelled = subs.some((s) => s.status === 'canceled');
  return hasCancelled;
};

/**
 * Returns the subscription that currently grants Builder/Studio/pause access,
 * if any. Prefers active/trialing; otherwise a canceled sub still inside its
 * paid period (covers legacy immediate-cancel cases).
 */
export const getActiveSubscriptions = async (stripeCustomerId) => {
  const allowedPriceIds = new Set(getAllowedSubscriptionPriceIds());
  const subs = await listCustomerSubscriptions(stripeCustomerId);

  const entitled = subs.filter(
    (subscription) =>
      allowedPriceIds.has(subscription.items?.data?.[0]?.price?.id) &&
      subscriptionGrantsEntitlement(subscription)
  );

  const activeOrTrialing = entitled.find((s) =>
    ['active', 'trialing'].includes(s.status)
  );
  if (activeOrTrialing) return activeOrTrialing;

  return (
    entitled
      .filter((s) => s.status === 'canceled')
      .sort((a, b) => b.current_period_end - a.current_period_end)[0] || null
  );
};

/**
 * Switch an active Builder/Studio subscription to the pause plan price.
 * Stores the prior price on Stripe metadata and the user record for resume.
 */
export const pauseSubscriptionToPausePlan = async (
  subscriptionId,
  currentStripeSubscription,
  userId
) => {
  const pausePriceId = getPauseSubscriptionPriceId();
  if (!pausePriceId) {
    throw new Error('PAUSE_SUBSCRIPTION_PRICE is not configured');
  }

  const currentPriceId =
    currentStripeSubscription?.items?.data?.[0]?.price?.id || null;
  if (!isBuilderOrStudioPriceId(currentPriceId)) {
    throw new Error('Only Builder or Studio subscriptions can be paused');
  }
  if (isPauseSubscriptionPriceId(currentPriceId)) {
    throw new Error('Subscription is already on the pause plan');
  }

  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: currentStripeSubscription.items.data[0].id,
        price: pausePriceId,
      },
    ],
    metadata: {
      ...(currentStripeSubscription.metadata || {}),
      pre_pause_price_id: currentPriceId,
    },
    proration_behavior: 'none',
  });

  if (userId) {
    await User.updateOne(
      { _id: userId },
      { $set: { pausedFromPriceId: currentPriceId } }
    );
  }

  return updated;
};

/**
 * Restore a pause-plan subscription to the Builder/Studio price held at pause time.
 */
export const resumeSubscriptionFromPausePlan = async (
  subscriptionId,
  currentStripeSubscription,
  userId,
  fallbackResumePriceId = null
) => {
  const currentPriceId =
    currentStripeSubscription?.items?.data?.[0]?.price?.id || null;
  if (!isPauseSubscriptionPriceId(currentPriceId)) {
    throw new Error('Subscription is not on the pause plan');
  }

  const resumePriceId =
    currentStripeSubscription?.metadata?.pre_pause_price_id ||
    fallbackResumePriceId;
  if (!resumePriceId || !isBuilderOrStudioPriceId(resumePriceId)) {
    throw new Error('Could not determine which plan to resume');
  }

  const clearedMetadata = { ...(currentStripeSubscription.metadata || {}) };
  delete clearedMetadata.pre_pause_price_id;

  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: currentStripeSubscription.items.data[0].id,
        price: resumePriceId,
      },
    ],
    metadata: clearedMetadata,
    proration_behavior: 'none',
  });

  if (userId) {
    await User.updateOne({ _id: userId }, { $set: { pausedFromPriceId: null } });
  }

  return updated;
};

export const getPriceListFromStripe = async () => {
  const priceList = await stripe.prices.list({
    product: process.env.STRIPE_PRODUCT_ID,
  });
  return priceList.data;
};

// Remove a pending cancelation
export const uncancelSubscription = async (subscriber) => {
  // Tell stripe
  await stripe.subscriptions.update(
    subscriber.subscription_id,
    {
      cancel_at_period_end: false,
    }
  );

  // Alright, lets update the subscriber so we have something to immediately return, rather than waiting for the webhook
  const updatedSubscriber = await Subscriber.findOneAndUpdate(
    // filter
    {
      _id: subscriber._id,
    },
    // new data
    {
      canceling: false,
    },
    // options
    {
      new: true, // return the new document
    },
  );

  return updatedSubscriber;
};

// Warning, this immediately cancels a subscription on Stripe, with no refund.
// Locally the Subscriber row is soft-deleted (deletedAt) and retained for
// audit/restore; webhook upserts can revive it via { includeDeleted: true }.
export const deleteSubscription = async (subscriber) => {
  // Cancel on Stripe

  try {
    await stripe.subscriptions.cancel(
      subscriber.subscription_id
    );
  } catch (error) {
    // if there's a problem cancelling, don't worry about it
  }

  // Soft-delete locally
  await Subscriber.updateOne(
    { _id: subscriber._id },
    { $set: { deletedAt: new Date() } }
  );
}

// Change subscription immediately (works for both upgrades and downgrades)
export const changeSubscription = async (subscriber, currentStripeSubscription, newStripePriceId) => {
  // Get current and new prices to determine if upgrade or downgrade
  const oldStripePrice = await stripe.prices.retrieve(currentStripeSubscription.items.data[0].price.id);
  const newStripePrice = await stripe.prices.retrieve(newStripePriceId);
  
  const isUpgrade = newStripePrice.unit_amount >= oldStripePrice.unit_amount;

  // Tell Stripe to immediately change the subscription
  await stripe.subscriptions.update(
    subscriber.subscription_id,
    {
      items: [
        {
          id: currentStripeSubscription.items.data[0].id,
          price: newStripePriceId,
        },
      ],
      // For upgrades, charge immediately with proration. For downgrades, also change immediately but credit will be applied
      proration_behavior: isUpgrade ? 'always_invoice' : 'create_prorations',
    }
  );

  // Alright, lets update the subscriber so we have something to immediately return, rather than waiting for the webhook
  const updatedSubscriber = await Subscriber.findOneAndUpdate(
    // filter
    {
      _id: subscriber._id,
    },
    // new data
    {
      planId: newStripePriceId,
      // Clear any old scheduling fields if they exist
      stripeScheduleId: null,
      futurePriceId: null,
    },
    // options
    {
      new: true, // return the new document
    },
  );

  return updatedSubscriber;
};

const toSafeCardSummary = (paymentMethod) => {
  if (!paymentMethod || paymentMethod.type !== 'card' || !paymentMethod.card) {
    return null;
  }
  return {
    paymentMethodId: paymentMethod.id,
    brand: paymentMethod.card.brand || null,
    last4: paymentMethod.card.last4 || null,
    expMonth: paymentMethod.card.exp_month || null,
    expYear: paymentMethod.card.exp_year || null,
    funding: paymentMethod.card.funding || null,
  };
};

/**
 * Resolve Stripe customer id for a logged-in user from User.stripeCustomerId.
 * Card data lives only in Stripe — we never look up a local Subscriber row.
 */
export const resolveStripeCustomerIdForUser = async (user) => {
  return user?.stripeCustomerId || null;
};

/** Safe display fields only — never returns PAN/CVC. */
export const getDefaultPaymentMethodSummary = async (stripeCustomerId) => {
  if (!stripeCustomerId) return null;

  const customer = await stripe.customers.retrieve(stripeCustomerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (!customer || customer.deleted) return null;

  let paymentMethod = customer.invoice_settings?.default_payment_method || null;
  if (typeof paymentMethod === 'string') {
    paymentMethod = await stripe.paymentMethods.retrieve(paymentMethod);
  }

  if (!paymentMethod) {
    const listed = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
      limit: 1,
    });
    paymentMethod = listed.data?.[0] || null;
  }

  return toSafeCardSummary(paymentMethod);
};

export const createPaymentMethodSetupIntent = async (stripeCustomerId) => {
  return stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });
};

/**
 * After Stripe Elements confirms a SetupIntent, set the new card as default
 * for the customer and all active/trialing subscriptions, then detach other cards.
 * Card numbers never pass through our servers — only Stripe payment_method ids.
 */
export const replaceDefaultPaymentMethod = async (
  stripeCustomerId,
  newPaymentMethodId
) => {
  if (!stripeCustomerId || !newPaymentMethodId) {
    throw new Error('Missing customer or payment method');
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(newPaymentMethodId);
  if (!paymentMethod || paymentMethod.type !== 'card') {
    throw new Error('Invalid payment method');
  }

  if (paymentMethod.customer && paymentMethod.customer !== stripeCustomerId) {
    throw new Error('Payment method does not belong to this customer');
  }
  if (!paymentMethod.customer) {
    await stripe.paymentMethods.attach(newPaymentMethodId, {
      customer: stripeCustomerId,
    });
  }

  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: {
      default_payment_method: newPaymentMethodId,
    },
  });

  const subscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: 'all',
    limit: 100,
  });
  const liveSubs = (subscriptions.data || []).filter((sub) =>
    ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)
  );
  await Promise.all(
    liveSubs.map((sub) =>
      stripe.subscriptions.update(sub.id, {
        default_payment_method: newPaymentMethodId,
      })
    )
  );

  const cards = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: 'card',
    limit: 100,
  });
  const detached = [];
  for (const card of cards.data || []) {
    if (card.id === newPaymentMethodId) continue;
    await stripe.paymentMethods.detach(card.id);
    detached.push({
      paymentMethodId: card.id,
      brand: card.card?.brand || null,
      last4: card.card?.last4 || null,
    });
  }

  return {
    paymentMethod: toSafeCardSummary(paymentMethod),
    detached,
  };
};
