// models/Wallet.js
import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: ["main", "rewards", "premium"],
    default: "main",
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: "NGN",
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  transactions: [
    {
      type: {
        type: String,
        enum: ["deposit", "withdraw", "redeem", "purchase"],
      },
      amount: Number,
      date: { type: Date, default: Date.now },
      status: { type: String, default: "completed" },
    },
  ],
});

const Wallet = mongoose.model("Wallet", walletSchema);
export default Wallet;
