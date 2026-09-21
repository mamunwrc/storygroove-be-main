import mongoose from 'mongoose';

const subscriberSchema = mongoose.Schema(
  {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'user',
    },
    planId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    subscription_status: {
      type: String,
      required: true,
      default: 'active',
    },
    canceling: {
      type: Boolean,
      default: false,
    },
    // Deprecated: No longer used for scheduling subscription changes
    stripeScheduleId: {
      type: String,
      default: null,
    },
    // Deprecated: No longer used for scheduling subscription changes
    futurePriceId: {
      type: String,
      default: null,
    },
    customer_id: {
      type: String,
      required: true,
    },
    subscription_id: {
      type: String,
      required: true,
      unique: true
    },
    purchased_on: {
      type: Date,
      required: true,
      default: Date.now,
    },
    subscribe_from_shopify: {
      type: Boolean,
      default: false,
    },
    cycleEndingOn: {
      type: Date
    },
    /**
     * Set when the subscriber is "deleted" (e.g. terminal Stripe state or manual cancel).
     * The row is retained for audit/restore; webhook upserts that may revive a previously
     * soft-deleted row must pass `{ includeDeleted: true }` and clear `deletedAt` in the
     * update payload (the existing unique index on `subscription_id` is left intact).
     */
    deletedAt: {
      type: Date,
      default: null,
    }
  },
  {
    timestamps: true,
  }
);

subscriberSchema.index({ subscription_id: 1, deletedAt: 1 });

/** Exclude soft-deleted Subscriber rows unless query opts pass { includeDeleted: true }. */
const SOFT_DELETE_QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'countDocuments',
];

subscriberSchema.pre(SOFT_DELETE_QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

// Returns true or false depending on whether the subscriber should have access
subscriberSchema.methods.isActive = function () {
  return ["active", "trialing"].includes(this.subscription_status);
};

subscriberSchema.methods.buildDataTransferObject = function () {
  return {
    userId: this.userid, // Our user id
    priceId: this.planId, // Stripe price id
    // name: this.name,
    // email: this.email,
    subscription_status: this.subscription_status,
    isCanceling: this.canceling,
    //hasCustomerId: !!this.customer_id, // Don't need to expose the Stripe customer ID
    //hasSubscriptionId: !!this.subscription_id, // Don't need to expose the Stripe subscription ID
    purchasedOn: this.purchased_on,
    cycleEndingOn: this.cycleEndingOn,
    subscribedFromShopify: this.subscribe_from_shopify,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Subscriber = mongoose.model('Subscriber', subscriberSchema);
export default Subscriber;
