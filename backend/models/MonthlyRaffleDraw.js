import mongoose from "mongoose";

const MonthlyRaffleDrawSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, index: true }, // "YYYY-MM"
    winningSets: { type: [[String]], default: [] },
    winnerUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    drawnAt: { type: Date, default: Date.now },
    claimed: { type: Boolean, default: false },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("MonthlyRaffleDraw", MonthlyRaffleDrawSchema);
