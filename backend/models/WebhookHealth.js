import mongoose from "mongoose";

const WebhookHealthSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "flutterwave", index: true },
    event: { type: String, default: "" },
    reference: { type: String, default: "" },
    amount: { type: Number, default: 0 },
    accountNumber: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    status: { type: String, default: "" },
    raw: { type: Object, default: {} },
    resolvedUserId: { type: String, default: "" },
    resolutionMethod: { type: String, default: "" },
    walletCredit: { type: Number, default: 0 },
    serviceCharge: { type: Number, default: 0 },
    processed: { type: Boolean, default: false },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("WebhookHealth", WebhookHealthSchema);
