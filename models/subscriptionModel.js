import e from 'express';
import mongoose from 'mongoose';

const subscriptionSchema = mongoose.Schema(
  {
    planId: {
      type: String,
      required: true,
    },
    priceId : {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    interval: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    subscription_status: {
      type: Boolean,
      required: true,
    },
    aiBgRemoval: {
      type: Boolean,
      required: true
    },
    aiPhotoBackgorundGenerator: {
      type: Number,
      required: true
    },
    aiVideos: {
      type: Number,
      required: true
    },
    photoEditing: {
      type: Boolean,
      required: true
    },
    templateOptions: {
      type: Boolean,
      required: true
    },
    aiDescriptionGeneratorShopify: {
      type: Boolean,
      required: true
    },
    aiCaptionSocialShare: {
      type: Boolean,
      required: true
    },
    autoSharing: {
      type: Boolean,
      required: true
    },
    support: {
      type: String,
      enum: ['email', 'priority'],
      required: true
    },
    isdeleted: {
      type: Boolean,
      default: false,
    },
    freeTrialDays: {
      type: Number,
      default : 0
    },
    visible: {
      type: Boolean,
      default: false,
    },
    /**
     * Set when the subscription product/price is "deleted" via Stripe webhook.
     * Retained for audit/restore. The legacy `isdeleted` boolean above is kept
     * untouched for backward compatibility but is not used by query filtering.
     */
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ planId: 1, deletedAt: 1 });
subscriptionSchema.index({ priceId: 1, deletedAt: 1 });

/** Exclude soft-deleted Subscription rows unless query opts pass { includeDeleted: true }. */
const SOFT_DELETE_QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'countDocuments',
];

subscriptionSchema.pre(SOFT_DELETE_QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

subscriptionSchema.methods.buildDataTransferObject = function () {
  return {
    productId: this.planId,
    priceId: this.priceId,
    name: this.name,
    currency: this.currency,
    amount: this.amount,
    interval: this.interval,
    aiBgRemovals: this.aiBgRemoval,
    aiPhotoBackgroundGenerations: this.aiPhotoBackgorundGenerator,
    aiVideos: this.aiVideos,
    support: this.support,
  };
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
