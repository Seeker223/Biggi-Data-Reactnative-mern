import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    monthlyFee: { type: Number, default: 100, required: true },
    isActive: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    renewalDate: { type: Date, default: null },
    paymentMethod: { type: String, default: null }, // "wallet", "card", etc.
    lastPaymentDate: { type: Date, default: null },
    autoRenew: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Subscription", subscriptionSchema);
