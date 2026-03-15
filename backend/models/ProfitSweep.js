import mongoose from "mongoose";

const ProfitSweepSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["initiated", "successful", "failed"],
      default: "initiated",
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },

    destination: {
      bankCode: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      accountName: { type: String, default: "" },
    },

    flutterwaveTransferId: { type: String, default: "" },
    flutterwaveStatus: { type: String, default: "" },
    flutterwaveResponse: { type: Object, default: {} },

    // Ledger entries included in this sweep (for marking swept)
    ledgerRefs: [{ type: String }],
  },
  { timestamps: true }
);

ProfitSweepSchema.index({ createdAt: -1 });

export default mongoose.model("ProfitSweep", ProfitSweepSchema);

