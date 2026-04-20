import mongoose from "mongoose";

const BiggiHouseMonthlyCardPlaySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    letters: { type: [String], default: [] },
  },
  { timestamps: true }
);

BiggiHouseMonthlyCardPlaySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.BiggiHouseMonthlyCardPlay ||
  mongoose.model("BiggiHouseMonthlyCardPlay", BiggiHouseMonthlyCardPlaySchema);

