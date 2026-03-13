import mongoose from "mongoose";

const MonthlyRaffleDrawSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, index: true }, // "YYYY-MM"
    winningCode: { type: String, required: true },
    winnerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: "MonthlyRaffleEntry", required: true },
    drawnAt: { type: Date, default: Date.now },
    claimed: { type: Boolean, default: false },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("MonthlyRaffleDraw", MonthlyRaffleDrawSchema);

