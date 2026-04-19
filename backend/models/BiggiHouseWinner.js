import mongoose from "mongoose";

const biggiHouseWinnerSchema = new mongoose.Schema(
  {
    houseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BiggiHouseHouse",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    paidAt: { type: Date, default: null },
    transactionRef: { type: String, default: "" },
  },
  { timestamps: true }
);

biggiHouseWinnerSchema.index({ houseId: 1, weekStart: 1 });
biggiHouseWinnerSchema.index({ userId: 1, weekStart: 1 });

const BiggiHouseWinner = mongoose.model("BiggiHouseWinner", biggiHouseWinnerSchema);
export default BiggiHouseWinner;