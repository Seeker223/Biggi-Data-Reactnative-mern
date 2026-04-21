import mongoose from "mongoose";

const BiggiHouseWeeklyCardPlaySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    weekKey: { type: String, required: true, index: true },
    letters: { type: [String], default: [] }, // 3 letters
  },
  { timestamps: true }
);

BiggiHouseWeeklyCardPlaySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.BiggiHouseWeeklyCardPlay ||
  mongoose.model("BiggiHouseWeeklyCardPlay", BiggiHouseWeeklyCardPlaySchema);

