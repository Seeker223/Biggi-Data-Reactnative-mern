import mongoose from "mongoose";

const MonthlyRaffleEntrySchema = new mongoose.Schema(
  {
    month: { type: String, required: true, index: true }, // "YYYY-MM"
    setIndex: { type: Number, required: true, min: 1, max: 5 },
    code: { type: String, required: true, minlength: 3, maxlength: 3 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["pending", "winner"], default: "pending" },
    playedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

MonthlyRaffleEntrySchema.index({ month: 1, user: 1, setIndex: 1 }, { unique: true });

export default mongoose.model("MonthlyRaffleEntry", MonthlyRaffleEntrySchema);
