import mongoose from "mongoose";

const DepositFeeSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    flatFee: { type: Number, default: 5 },
    percentFee: { type: Number, default: 0 },
    minFee: { type: Number, default: 0 },
    maxFee: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("DepositFeeSettings", DepositFeeSettingsSchema);
