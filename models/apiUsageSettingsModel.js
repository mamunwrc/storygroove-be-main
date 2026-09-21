import mongoose from "mongoose";

const planSpendLimitSchema = new mongoose.Schema(
  {
    priceId: { type: String, required: true },
    planName: { type: String },
    monthlySpendLimit: { type: Number, required: true },
  },
  { _id: false }
);

const apiUsageSettingsSchema = new mongoose.Schema(
  {
    planSpendLimits: {
      type: [planSpendLimitSchema],
      default: [],
    },
    trialSpendLimit: {
      type: Number,
      default: 20,
    },
    fallbackSpendLimit: {
      type: Number,
      default: 50,
    },
    defaultRpmLimit: {
      type: Number,
      default: 60,
    },
    defaultRpdLimit: {
      type: Number,
      default: 10000,
    },
    defaultTpmLimit: {
      type: Number,
      default: 90000,
    },
    defaultTpdLimit: {
      type: Number,
      default: 2000000,
    },
    /** Max estimated API spend (USD) per Simone Story Starter thread before session is paused. Use 0 to disable. */
    simoneSessionSpendCap: {
      type: Number,
      default: 3,
    },
    coverImageModel: {
      type: String,
      enum: ["gpt-image-2", "gpt-image-1.5"],
      default: "gpt-image-2",
    },
    /** Partial preview frames during cover render (0–3). 0 disables streaming. */
    coverImagePartialImages: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
    /** Max cover image renders per user per billing period. Use 0 for unlimited. */
    coverRendersPerBillingPeriod: {
      type: Number,
      default: 10,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

apiUsageSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  let needsSave = false;
  if (settings.globalRpmLimit != null && settings.defaultRpmLimit == null) {
    settings.defaultRpmLimit = settings.globalRpmLimit;
    needsSave = true;
  }
  if (settings.globalRpdLimit != null && settings.defaultRpdLimit == null) {
    settings.defaultRpdLimit = settings.globalRpdLimit;
    needsSave = true;
  }
  if (settings.globalTpmLimit != null && settings.defaultTpmLimit == null) {
    settings.defaultTpmLimit = settings.globalTpmLimit;
    needsSave = true;
  }
  if (settings.globalTpdLimit != null && settings.defaultTpdLimit == null) {
    settings.defaultTpdLimit = settings.globalTpdLimit;
    needsSave = true;
  }
  // Migrate old hardLimitThreshold to fallbackSpendLimit
  if (settings.hardLimitThreshold != null && settings.fallbackSpendLimit == null) {
    settings.fallbackSpendLimit = settings.hardLimitThreshold;
    needsSave = true;
  }
  if (settings.trialSpendLimit == null) {
    settings.trialSpendLimit = 20;
    needsSave = true;
  }
  if (settings.fallbackSpendLimit == null) {
    settings.fallbackSpendLimit = 50;
    needsSave = true;
  }
  if (settings.simoneSessionSpendCap == null) {
    settings.simoneSessionSpendCap = 3;
    needsSave = true;
  }
  if (settings.coverImageModel == null) {
    settings.coverImageModel = "gpt-image-2";
    needsSave = true;
  }
  if (settings.coverImagePartialImages == null) {
    settings.coverImagePartialImages = 0;
    needsSave = true;
  }
  if (settings.coverRendersPerBillingPeriod == null) {
    settings.coverRendersPerBillingPeriod = 10;
    needsSave = true;
  }
  if (needsSave) await settings.save();
  return settings;
};

/**
 * Resolve the effective monthly spend limit for a given user.
 * Priority: user.monthlySpendLimit > plan limit > trial limit > fallback limit
 *
 * @param {object} user       - The Mongoose user document
 * @param {object|null} subscriber - The active Subscriber document (or null)
 * @returns {{ limit: number, source: string }}
 */
apiUsageSettingsSchema.methods.resolveSpendLimit = function (user, subscriber) {
  const fallbackLimit = this.fallbackSpendLimit ?? 50;
  const trialLimit = this.trialSpendLimit ?? 20;

  if (user.monthlySpendLimit != null && user.monthlySpendLimit > 0) {
    return { limit: user.monthlySpendLimit, source: "custom" };
  }

  if (subscriber) {
    const planEntry = (this.planSpendLimits || []).find(
      (p) => p.priceId === subscriber.planId
    );
    if (planEntry && planEntry.monthlySpendLimit != null) {
      return {
        limit: planEntry.monthlySpendLimit,
        source: planEntry.planName || "plan",
      };
    }
    return { limit: fallbackLimit, source: "default" };
  }

  return { limit: trialLimit, source: "trial" };
};

const ApiUsageSettings = mongoose.model(
  "ApiUsageSettings",
  apiUsageSettingsSchema
);
export default ApiUsageSettings;
