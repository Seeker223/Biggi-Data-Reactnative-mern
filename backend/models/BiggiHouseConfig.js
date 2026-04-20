import mongoose from "mongoose";

const BiggiHouseConfigSchema = new mongoose.Schema(
  {
    singleton: { type: Boolean, default: true, unique: true, index: true },
    weeklyPayout: {
      dayOfWeek: { type: Number, default: 0 },
      hour: { type: Number, default: 22 },
      minute: { type: Number, default: 0 },
    },
    features: {
      monthlyCardGameEnabled: { type: Boolean, default: false },
    },
    game: {
      requireDataPurchase: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export default mongoose.models.BiggiHouseConfig ||
  mongoose.model("BiggiHouseConfig", BiggiHouseConfigSchema);

