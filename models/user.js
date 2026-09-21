import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    fname: {
      type: String,
      required: [true, "Please provide name"],
      maxlength: 50,
    },
    lname: {
      type: String,
      required: [true, "Please provide name"],
      maxlength: 50,
    },
    username: {
      type: String,
      required: [true, "Please provide name"],
      maxlength: 50,
      unique: true,
    },
    password: {
      type: String,
      required: [true, "please provide a password"],
      // maxlength: 50,
      minlength: 8,
    },
    email: {
      type: String,
      unique: true,
      required: [true, "Please provide email"],
      validate: {
        validator: function (value) {
          const isEmailValid = validator.isEmail(value);
          const signupType = this.signupType === "shopify";
          return isEmailValid || signupType;
        },
        message: "Please provide valid email",
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "deleted"],
      default: "inactive",
    },
    role: {
      type: String,
      enum: ["superadmin", "admin", "user"],
      default: "user",
    },
    signupType: {
      type: String,
      enum: ["register", "facebook", "google", "shopify", "stripe_checkout"],
      default: "register",
    },
    /** Checkout-first signups must set a real password after email verification. */
    passwordSetupRequired: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: String,
    },
    verificationToken: {
      token: String,
      expires: Date,
    },
    userType: {
      type: String,
      enum: ["merchant", "agency", "influencer", "other"],
    },
    openaiKey: {
      type: String,
    },
    assistantId: {
      type: String,
    },
    image: {
      type: String,
      default: null,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    stripeCustomerId: {
      type: String,
      default: null,
    },
    /** Builder/Studio price id saved when the user switches to PAUSE_SUBSCRIPTION_PRICE. */
    pausedFromPriceId: {
      type: String,
      default: null,
    },
    simoneOneTimePaid: {
      type: Boolean,
      default: false,
    },
    simoneOneTimePaidAt: {
      type: Date,
      default: null,
    },
    simoneCreditsRemaining: {
      type: Number,
      default: 0,
      min: 0,
    },
    simonePaymentsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    simoneKitsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    apiUsageStatus: {
      type: String,
      enum: ["active", "blocked", "limit_reached"],
      default: "active",
    },
    monthlySpendLimit: {
      type: Number,
      default: null,
    },
    customRpmLimit: {
      type: Number,
      default: null,
    },
    customRpdLimit: {
      type: Number,
      default: null,
    },
    customTpmLimit: {
      type: Number,
      default: null,
    },
    customTpdLimit: {
      type: Number,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    passwordResetRequestedAt: {
      type: Date,
      default: null,
    },
    verificationEmailSentAt: {
      type: Date,
      default: null,
    },
    twoFactor: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      lastSentAt: { type: Date, default: null },
    },
    /** Last project the user opened from the dashboard (novel, Simone, Olivia, or Ellis). */
    lastOpenedWork: {
      kind: {
        type: String,
        enum: ["novel", "simone", "olivia", "ellis"],
        default: null,
      },
      resourceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      threadId: { type: String, default: null },
      name: { type: String, default: null },
      uploaded: { type: Boolean, default: false },
      status: { type: String, default: null },
      openedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

userSchema.pre("save", function () {
  if (this.isModified("email") && this.email) {
    this.email = this.email.toLowerCase();
  }
  if (this.isModified("username") && this.username) {
    this.username = this.username.toLowerCase();
  }
});

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePasword = async function (userPassword) {
  const isMatch = await bcrypt.compare(userPassword, this.password);
  return isMatch;
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

userSchema.methods.registerFailedLogin = async function () {
  const MAX_ATTEMPTS = 15;
  const LOCK_MS = 15 * 60 * 1000;

  if (this.lockUntil && this.lockUntil.getTime() <= Date.now()) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $set: { failedLoginAttempts: 0, lockUntil: null } }
    );
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
  }

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    { $inc: { failedLoginAttempts: 1 } },
    { new: true }
  );

  if (updated.failedLoginAttempts >= MAX_ATTEMPTS) {
    await this.constructor.updateOne(
      { _id: this._id },
      {
        $set: {
          lockUntil: new Date(Date.now() + LOCK_MS),
          failedLoginAttempts: 0,
        },
      }
    );
  }
};

userSchema.methods.registerSuccessfulLogin = async function () {
  if (!this.failedLoginAttempts && !this.lockUntil) return;
  await this.constructor.updateOne(
    { _id: this._id },
    { $unset: { failedLoginAttempts: "", lockUntil: "" } }
  );
};

const TWO_FACTOR_CODE_TTL_MS = 10 * 60 * 1000;
const TWO_FACTOR_MAX_ATTEMPTS = 5;
const TWO_FACTOR_RESEND_COOLDOWN_MS = 60 * 1000;

userSchema.methods.issueTwoFactorCode = async function () {
  const code = String(crypto.randomInt(100000, 1000000));
  const salt = await bcrypt.genSalt(10);
  const codeHash = await bcrypt.hash(code, salt);
  const now = new Date();

  await this.constructor.updateOne(
    { _id: this._id },
    {
      $set: {
        "twoFactor.codeHash": codeHash,
        "twoFactor.expiresAt": new Date(now.getTime() + TWO_FACTOR_CODE_TTL_MS),
        "twoFactor.attempts": 0,
        "twoFactor.lastSentAt": now,
      },
    }
  );

  return code;
};

userSchema.methods.verifyTwoFactorCode = async function (code) {
  const fresh = await this.constructor
    .findById(this._id)
    .select("twoFactor");
  const tf = fresh?.twoFactor;

  if (!tf || !tf.codeHash || !tf.expiresAt) {
    return false;
  }

  if (tf.expiresAt.getTime() < Date.now()) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $unset: { twoFactor: "" } }
    );
    return false;
  }

  if ((tf.attempts || 0) >= TWO_FACTOR_MAX_ATTEMPTS) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $unset: { twoFactor: "" } }
    );
    return false;
  }

  const isMatch = await bcrypt.compare(String(code || ""), tf.codeHash);

  if (!isMatch) {
    const updated = await this.constructor.findOneAndUpdate(
      { _id: this._id },
      { $inc: { "twoFactor.attempts": 1 } },
      { new: true }
    );
    if (
      updated?.twoFactor &&
      (updated.twoFactor.attempts || 0) >= TWO_FACTOR_MAX_ATTEMPTS
    ) {
      await this.constructor.updateOne(
        { _id: this._id },
        { $unset: { twoFactor: "" } }
      );
    }
    return false;
  }

  await this.constructor.updateOne(
    { _id: this._id },
    { $unset: { twoFactor: "" } }
  );
  return true;
};

userSchema.methods.canResendTwoFactor = function () {
  const lastSentAt = this.twoFactor?.lastSentAt;
  if (!lastSentAt) return true;
  return Date.now() - new Date(lastSentAt).getTime() >= TWO_FACTOR_RESEND_COOLDOWN_MS;
};

userSchema.methods.createJWT = function () {
  return jwt.sign(
    {
      userId: this._id,
      email: this.email,
      role: this.role,
      branch: this.branch,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_LIFETIME || "1d",
    }
  );
};

userSchema.methods.checkUserStatue = function () {
  switch (this.status) {
    case "inactive":
      return { hasError: true, message: "Your account is not approved yet" };
    case "blocked":
      return { hasError: true, message: "Your account is blocked" };
    case "deleted":
      return {
        hasError: true,
        message:
          "Your account is deleted, Please reach out to out customer care to make you account active",
      };
    case "active":
      return { hasError: false };
    default:
      return {
        hasError: true,
        message:
          "Your account verification failed, Please get in contact with our support team",
      };
  }
};

const User = mongoose.model("User", userSchema);
export default User;
