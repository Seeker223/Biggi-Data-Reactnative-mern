import mongoose from "mongoose";

const WeeklyLetterDrawResultSchema = new mongoose.Schema(
  {
    // Format: "YYYY-MM"
    month: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: [/^\d{4}-\d{2}$/, "Invalid month format (expected YYYY-MM)"],
    },
    winningNumbers: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 5,
        message: "Winning numbers must contain exactly 5 values",
      },
    },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("WeeklyLetterDrawResult", WeeklyLetterDrawResultSchema);

