import mongoose from "mongoose";

// Controls automatic profit sweep to a dedicated BiggiData account.
const ProfitSweepSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    // Minimum total profit required before a sweep is initiated.
    minAmount: { type: Number, default: 5000 },

    // Flutterwave transfer destination
    currency: { type: String, default: "NGN" },
    bankCode: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    accountName: { type: String, default: "" },

    // Cron schedule for auto sweep (Africa/Lagos by default).
    // Default: every day at 23:55.
    cron: { type: String, default: "55 23 * * *" },
    timezone: { type: String, default: "Africa/Lagos" },

    narration: { type: String, default: "BiggiData profit sweep" },
  },
  { timestamps: true }
);

export default mongoose.model("ProfitSweepSettings", ProfitSweepSettingsSchema);

