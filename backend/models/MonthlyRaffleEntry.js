import mongoose from "mongoose";

const MonthlyRaffleEntrySchema = new mongoose.Schema(
  {
    month: { type: String, required: true, index: true }, // "YYYY-MM"
    code: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["pending", "winner"], default: "pending" },
    playedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

MonthlyRaffleEntrySchema.index({ month: 1, code: 1 }, { unique: true });

export default mongoose.model("MonthlyRaffleEntry", MonthlyRaffleEntrySchema);

