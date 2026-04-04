import mongoose from "mongoose";

const MerchantWeeklyCardDrawResultSchema = new mongoose.Schema(
  {
    // Format: "YYYY-WW" (ISO week)
    week: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: [/^\d{4}-W\d{2}$/, "Invalid week format (expected YYYY-WW)"],
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
      required: true,
      min: 0,
      max: 2,
    },
    winningNumbers: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 3,
        message: "Winning numbers must contain exactly 3 values",
      },
    },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model(
  "MerchantWeeklyCardDrawResult",
  MerchantWeeklyCardDrawResultSchema
);
