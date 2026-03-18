import mongoose from "mongoose";

const EmailSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    rateLimitPerHour: { type: Number, default: 20 },
    perType: { type: Object, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("EmailSettings", EmailSettingsSchema);
