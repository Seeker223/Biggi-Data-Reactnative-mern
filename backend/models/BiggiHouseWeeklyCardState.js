import mongoose from "mongoose";

const BiggiHouseWeeklyCardStateSchema = new mongoose.Schema(
  {
    weekKey: { type: String, required: true, unique: true, index: true },
    letters: { type: [String], default: [] }, // 9 letters (A-Z)
    winningGroupIndex: { type: Number, default: 0 }, // 0..2
    revealAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.BiggiHouseWeeklyCardState ||
  mongoose.model("BiggiHouseWeeklyCardState", BiggiHouseWeeklyCardStateSchema);

