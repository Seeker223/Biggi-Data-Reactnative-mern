import mongoose from "mongoose";

const UnmatchedDepositSchema = new mongoose.Schema(
  {
    reference: { type: String, default: "", index: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "NGN" },
    accountNumber: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    status: { type: String, default: "unmatched" },
    provider: { type: String, default: "flutterwave" },
    payload: { type: Object, default: {} },
  },
  { timestamps: true }
);

UnmatchedDepositSchema.index({ createdAt: -1 });

export default mongoose.model("UnmatchedDeposit", UnmatchedDepositSchema);
