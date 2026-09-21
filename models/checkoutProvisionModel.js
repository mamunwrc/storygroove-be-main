import mongoose from "mongoose";

const checkoutProvisionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
  },
  { timestamps: true }
);

const CheckoutProvision = mongoose.model(
  "CheckoutProvision",
  checkoutProvisionSchema
);

export default CheckoutProvision;
