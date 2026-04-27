import mongoose from "mongoose";

const MerchantWeeklyCardDrawResultSchema = new mongoose.Schema(
  {
    // Format: "YYYY-MM"
    month: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: [/^\d{4}-\d{2}$/, "Invalid month format (expected YYYY-MM)"],
    },
    letters: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 9,
        message: "Letters must contain exactly 9 values",
      },
    },
    winningGroupIndex: {
      type: Number,
      default: null,
    },
    winningNumbers: {
      type: [Number],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          (v.length === 0 || v.length === 3 || v.length === 9),
        message: "Winning numbers must contain 0, 3, or 9 values",
      },
      default: [],
    },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model(
  "MerchantWeeklyCardDrawResult",
  MerchantWeeklyCardDrawResultSchema
);
