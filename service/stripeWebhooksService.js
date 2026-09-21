import dotEnv from 'dotenv';
import Stripe from 'stripe';

import * as StripeService from './stripeService.js';
import * as CheckoutProvisioningService from './checkoutProvisioningService.js';

import Invoice from "../models/invoicesModel.js";
import Subscriber from '../models/subscriberModel.js';
import Subscription from '../models/subscriptionModel.js';
import User from '../models/user.js';



dotEnv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Stripe metadata values are strings. API list uses visible in [null, true].
 * Missing/empty metadata → show. Set product metadata visible=true to show; visible=false to hide.
 */
const productVisibleForCatalog = (metadata) => {
  if (!metadata || metadata.visible === undefined || metadata.visible === '') {
    return true;
  }
  return String(metadata.visible).toLowerCase() === 'true';
};

// create a function to add invoice
const addInvoice = async (user, stripeInvoice) => {
  await Invoice.create({
    user: user._id,
    invoiceId: stripeInvoice.id,
    invoiceTimestamp: (stripeInvoice.created * 1000), // stripe epoch seconds to mongoDB epoch milli
    invoiceAmount: (stripeInvoice.total / 100.0) , // stripe cents to dollar with decimals
    customerName: stripeInvoice.customer_name,
    customerEmail: stripeInvoice.customer_email,
    downloadUrl: stripeInvoice.invoice_pdf,
    status: stripeInvoice.status
  });
}

// get invoice from stripe by invoice id
export const processInvoice = async (stripeInvoice, errorCb) => {
  const user = await StripeService.findUserForCustomerId(stripeInvoice.customer);

  if (!user) {
    errorCb(`stripeWebhooksService - processInvoice: cannot find a user account for the given stripe customer: ${stripeInvoice.customer}`);
    return;
  }

  await addInvoice(user, stripeInvoice);

  // If payment succeeded and there's a subscription, ALWAYS update subscription status to "active"
  if (stripeInvoice.status === 'paid' && stripeInvoice.subscription) {
    console.log(`stripeWebhooksService - processInvoice: Payment succeeded for invoice ${stripeInvoice.id}, subscription ${stripeInvoice.subscription}`);
    
    // ALWAYS force update to active when payment succeeds, regardless of what Stripe subscription status says
    // This is the source of truth - if payment succeeded, subscription should be active
    try {
      const updateData = {
        subscription_status: 'active', // Always set to active when payment succeeds
      };
      
      // Try to get subscription details from Stripe for additional info
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(stripeInvoice.subscription);
        console.log(`stripeWebhooksService - processInvoice: Retrieved subscription ${stripeInvoice.subscription}, Stripe status: ${stripeSubscription.status}`);
        
        // Update cycle dates if available
        if (stripeSubscription.current_period_start) {
          updateData.purchased_on = new Date(stripeSubscription.current_period_start * 1000);
        }
        if (stripeSubscription.current_period_end) {
          updateData.cycleEndingOn = new Date(stripeSubscription.current_period_end * 1000);
        }
        
        // If Stripe says it's trialing, use that instead
        if (stripeSubscription.status === 'trialing') {
          updateData.subscription_status = 'trialing';
        }
      } catch (subErr) {
        console.warn(`stripeWebhooksService - processInvoice: Could not retrieve subscription details, using invoice data:`, subErr.message);
        // Use invoice data if subscription retrieval fails
        if (stripeInvoice.period_start) {
          updateData.purchased_on = new Date(stripeInvoice.period_start * 1000);
        }
        if (stripeInvoice.period_end) {
          updateData.cycleEndingOn = new Date(stripeInvoice.period_end * 1000);
        }
      }
      
      // Include soft-deleted rows so a paid invoice can revive a previously
      // soft-deleted subscriber; clear deletedAt explicitly.
      const updated = await Subscriber.findOneAndUpdate(
        {
          subscription_id: stripeInvoice.subscription,
        },
        { ...updateData, deletedAt: null },
        {
          new: true,
          upsert: false, // Don't create if doesn't exist - subscription webhook should create it
          includeDeleted: true,
        }
      );
      
      if (updated) {
        console.log(`stripeWebhooksService - processInvoice: ✅ SUCCESS - Updated subscription ${stripeInvoice.subscription} status to ${updateData.subscription_status} after payment succeeded`);
      } else {
        console.warn(`stripeWebhooksService - processInvoice: ⚠️ Subscription ${stripeInvoice.subscription} not found in database yet (may be created by subscription webhook)`);
        // Subscription might not exist yet if invoice webhook arrives before subscription webhook
        // That's okay, the subscription webhook will create it and then this will update it
      }
    } catch (err) {
      // If subscription doesn't exist or there's an error, log it but don't fail the invoice processing
      console.error(`stripeWebhooksService - processInvoice: ❌ ERROR updating subscription status for invoice ${stripeInvoice.id}:`, err);
    }
  }
}

export const processWebhookCustomerDeleted = async (stripeCustomer) => {
  // If we have a user with that strupeCustomerId, unlink it
  // Any subscriptions they have, that we may also have, will get a webhook from stripe, so don't worry about those
  await User.findOneAndUpdate(
    // filter
    {
      stripeCustomerId: stripeCustomer.id,
    },
    // data
    {
      stripeCustomerId: null
    },
  );
};

export const processWebhookSubscriptionCreatedOrUpdated = async (stripeSubscription, errorCb) => {
  let user = await StripeService.findUserForCustomerId(stripeSubscription.customer);

  if (!user) {
    try {
      const provisionResult =
        await CheckoutProvisioningService.provisionUserFromStripeCustomer(
          stripeSubscription.customer
        );
      user = provisionResult?.user || null;
    } catch (provisionErr) {
      console.error(
        "processWebhookSubscriptionCreatedOrUpdated provisioning fallback failed:",
        provisionErr.message
      );
    }
  }

  if (!user) {
    errorCb(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: cannot find a user account for the given stripe customer: ${stripeSubscription.customer}`);
    return;
  }

  if (["unpaid", "incomplete_expired"].includes(stripeSubscription.status)) {
    // If the status is a terminal state (but not canceled - we keep canceled subscriptions), soft-delete our records
    await Subscriber.updateOne(
      { subscription_id: stripeSubscription.id },
      { $set: { deletedAt: new Date() } }
    );
    return;
  }

  // Check if subscription already exists (needed for both canceled and active subscriptions).
  // Include soft-deleted rows so the upserts below can revive a previously deleted subscriber
  // instead of inserting a duplicate and hitting the unique index on subscription_id.
  const existingSubscriber = await Subscriber.findOne({ subscription_id: stripeSubscription.id })
    .setOptions({ includeDeleted: true });

  // Handle canceled subscriptions - keep the record but mark as canceled
  if (stripeSubscription.status === "canceled") {
    const newPriceId = stripeSubscription.items.data[0]?.price?.id || existingSubscriber?.planId;
    
    await Subscriber.findOneAndUpdate(
      {
        subscription_id: stripeSubscription.id,
      },
      {
        userid: user._id,
        subscription_id: stripeSubscription.id,
        planId: newPriceId,
        productId: stripeSubscription.items.data[0]?.price?.product,
        subscription_status: 'canceled',
        canceling: false,
        purchased_on: stripeSubscription.current_period_start 
          ? new Date(stripeSubscription.current_period_start * 1000) 
          : existingSubscriber?.purchased_on,
        cycleEndingOn: stripeSubscription.current_period_end 
          ? new Date(stripeSubscription.current_period_end * 1000) 
          : existingSubscriber?.cycleEndingOn,
        name: user.fname,
        email: user.email,
        customer_id: stripeSubscription.customer,
        stripeScheduleId: null,
        futurePriceId: null,
        // Revive any previously soft-deleted row matching this subscription_id.
        deletedAt: null,
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        new: true,
        includeDeleted: true,
      },
    );
    
    console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Subscription ${stripeSubscription.id} marked as canceled`);
    return;
  }

  const newPriceId = stripeSubscription.items.data[0].price.id;
  
  let statusToSave = stripeSubscription.status;
  
  // If subscription is incomplete, ALWAYS check if payment has actually succeeded
  // Never save incomplete status if payment has succeeded
  if (stripeSubscription.status === 'incomplete') {
    try {
      // Check ALL invoices for this subscription to see if any payment succeeded
      const invoices = await stripe.invoices.list({
        subscription: stripeSubscription.id,
        limit: 10, // Check more invoices to be sure
      });
      
      // Check if any invoice is paid
      const hasPaidInvoice = invoices.data.some(inv => inv.status === 'paid');
      
      if (hasPaidInvoice) {
        // Payment has succeeded, so subscription should be active
        console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Subscription ${stripeSubscription.id} shows incomplete but has paid invoice, setting to active`);
        statusToSave = 'active';
      } else if (existingSubscriber && 
          (existingSubscriber.subscription_status === 'active' || existingSubscriber.subscription_status === 'trialing')) {
        // Keep existing active status if we already have it (don't downgrade)
        console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Keeping existing active status for subscription ${stripeSubscription.id} instead of incomplete`);
        statusToSave = existingSubscriber.subscription_status;
      } else {
        // No paid invoice and no existing active status - keep incomplete for now
        console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Subscription ${stripeSubscription.id} is incomplete with no paid invoice yet`);
      }
    } catch (err) {
      console.error(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Error checking invoices for subscription ${stripeSubscription.id}:`, err);
      // If we can't check, and we have an existing active status, keep it (never downgrade)
      if (existingSubscriber && 
          (existingSubscriber.subscription_status === 'active' || existingSubscriber.subscription_status === 'trialing')) {
        console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Error checking invoices, keeping existing active status for subscription ${stripeSubscription.id}`);
        statusToSave = existingSubscriber.subscription_status;
      }
    }
  } else if (existingSubscriber && 
      existingSubscriber.subscription_status === 'active' && 
      stripeSubscription.status === 'incomplete') {
    // Never downgrade from active to incomplete
    console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Preventing downgrade from active to incomplete for subscription ${stripeSubscription.id}`);
    statusToSave = 'active';
  }

  console.log(`stripeWebhooksService - processWebhookSubscriptionCreatedOrUpdated: Updating subscription ${stripeSubscription.id} with status ${statusToSave} (Stripe status: ${stripeSubscription.status})`);

  await Subscriber.findOneAndUpdate(
    // filter
    {
      subscription_id: stripeSubscription.id,
    },
    // new data
    {
      userid: user._id,
      subscription_id: stripeSubscription.id,
      planId: newPriceId,
      productId: stripeSubscription.items.data[0].price.product,
      subscription_status: statusToSave,
      canceling: stripeSubscription.cancel_at_period_end,
      purchased_on: new Date(stripeSubscription.current_period_start * 1000),
      cycleEndingOn: new Date(stripeSubscription.current_period_end * 1000),
      // Stuff to eventually remove from the model, but we need for now
      name: user.fname,
      email: user.email,
      customer_id: stripeSubscription.customer,
      // Clear deprecated scheduling fields
      stripeScheduleId: null,
      futurePriceId: null,
      // Revive any previously soft-deleted row matching this subscription_id
      // so the upsert below doesn't insert a duplicate (subscription_id is unique).
      deletedAt: null,
    },
    // options
    {
      upsert: true,
      setDefaultsOnInsert: true,
      new: true, // return the new document, not the old
      includeDeleted: true,
    },
  );
};

export const processWebhookSubscriptionDeleted = async (stripeSubscription, errorCb) => {
  await Subscriber.updateOne(
    { subscription_id: stripeSubscription.id },
    { $set: { deletedAt: new Date() } }
  );
};

const upsertSubscription = async (stripeProduct, stripePrice) => {
  try {
    await Subscription.findOneAndUpdate(
      // filter
      {
        planId: stripeProduct.id,
      },
      // new data
      {
        planId: stripeProduct.id,
        priceId: stripeProduct.default_price,
        name: stripeProduct.name,
        currency: stripePrice.currency,
        // This may be a problem eventually, if we support currencies that don't have 2 decimal places:
        // https://stripe.com/docs/currencies#zero-decimal
        amount: parseInt(stripePrice.unit_amount / 100),
        interval: stripePrice.recurring.interval ?? 'month',
        description: stripeProduct.description,
        subscription_status: stripeProduct.active,
        visible: productVisibleForCatalog(stripeProduct.metadata),
        aiBgRemoval: true,
        aiPhotoBackgorundGenerator: stripeProduct.metadata.generations_bg ?? 0,
        aiVideos: stripeProduct.metadata.generations_video ?? 0,
        support: Subscription.schema.path('support').enumValues.includes(stripeProduct.metadata.support) ? stripeProduct.metadata.support : "email",
        // Possibly Legacy fields
        photoEditing: true,
        templateOptions : true,
        aiDescriptionGeneratorShopify: true,
        aiCaptionSocialShare : true,
        autoSharing : true,
        freeTrialDays: 0,
        // Revive any previously soft-deleted Subscription row for this planId.
        deletedAt: null,
      },
      // options
      {
        upsert: true,
        setDefaultsOnInsert: true,
        new: true, // return the new document, not the old
        includeDeleted: true,
      },
    );
  } catch (err) {
    // We may get an in-progress edit, where someone forgot important metadata
    // In that case, don't do anything, and log an error
    // Ideally, future edits will eventually send us a correct object
    console.error("stripeWebhooksService - upsertSubscription: ran into an error upserting subscription data", err);
  }
};

export const processWebhookProductCreatedOrUpdated = async (stripeProduct) => {
  // When first creating a product, we'll receive a webhook with no price
  // In that case, just disregard until we get a future update
  if (!stripeProduct.default_price) return;

  const stripePrice = await stripe.prices.retrieve(stripeProduct.default_price);
  await upsertSubscription(stripeProduct, stripePrice);
};

export const processWebhookProductDeleted = async (stripeProduct) => {
  await Subscription.updateOne(
    { planId: stripeProduct.id },
    { $set: { deletedAt: new Date() } }
  );
};

export const processWebhookPriceCreatedOrUpdated = async (stripePrice) => {
  const stripeProduct = await stripe.products.retrieve(stripePrice.product);
  await upsertSubscription(stripeProduct, stripePrice);
};

export const processWebhookPriceDeleted = async (stripePrice) => {
  await Subscription.updateOne(
    { priceId: stripePrice.id },
    { $set: { deletedAt: new Date() } }
  );
};

// calculateFuturePriceIdFromStripeSchedule - removed, no longer needed since we don't use scheduling

// Schedule webhook handlers - no longer needed since we don't use scheduling
// Keeping them to clear any existing schedule data if webhooks still come through
export const processScheduleCreated = async (stripeSchedule) => {
  // Clear any schedule data if it exists. Include soft-deleted rows so we
  // also wipe deprecated schedule fields on archived subscribers.
  await Subscriber.findOneAndUpdate(
    // filter
    {
      subscription_id: stripeSchedule.subscription,
    },
    // new data
    {
      stripeScheduleId: null,
      futurePriceId: null,
    },
    // options
    {
      new: true, // return the new document, not the old
      includeDeleted: true,
    },
  );
};

export const processScheduleUpdated = async (stripeSchedule) => {
  // Clear any schedule data if it exists. Include soft-deleted rows so we
  // also wipe deprecated schedule fields on archived subscribers.
  await Subscriber.findOneAndUpdate(
    // filter
    {
      stripeScheduleId: stripeSchedule.id,
    },
    // new data
    {
      stripeScheduleId: null,
      futurePriceId: null,
    },
    // options
    {
      new: true, // return the new document, not the old
      includeDeleted: true,
    },
  );
};

export const processScheduleReleaedOrDeleted = async (stripeSchedule) => {
  await Subscriber.findOneAndUpdate(
    // filter
    {
      stripeScheduleId: stripeSchedule.id,
    },
    // new data
    {
      stripeScheduleId: null,
      futurePriceId: null,
    },
    // options
    {
      new: true, // return the new document, not the old
      includeDeleted: true,
    },
  );
};
