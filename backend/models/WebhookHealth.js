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
  },
  { timestamps: true }
);

export default mongoose.model("WebhookHealth", WebhookHealthSchema);
