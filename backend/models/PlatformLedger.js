import mongoose from "mongoose";

// Platform-level ledger to track BiggiData revenue/cost/profit per transaction.
const PlatformLedgerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["data_purchase"],
      required: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reference: { type: String, required: true, index: true },

    network: { type: String, default: "" },
    category: { type: String, default: "" },
    plan_id: { type: String, default: "" },
    providerPlanCode: { type: String, default: "" },

    // Amount user was charged in-app.
    revenue: { type: Number, required: true },
    // What provider charged us (Zenipoint). Nullable when unknown.
    cost: { type: Number, default: null },
    // revenue - cost (nullable if cost unknown).
    profit: { type: Number, default: null },

    // Raw provider response snippet for auditing (kept small).
    provider: { type: Object, default: {} },
  },
  { timestamps: true }
);

PlatformLedgerSchema.index({ createdAt: -1 });

export default mongoose.model("PlatformLedger", PlatformLedgerSchema);

