import mongoose from "mongoose";

const BiggiHouseWalletTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["deposit", "withdraw", "house_join", "subscription"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    status: { type: String, default: "completed" },
    reference: { type: String, default: "" },
    meta: { type: Object, default: {} },
  },
  { _id: true }
);

const biggiHouseWalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "NGN" },
    lastUpdated: { type: Date, default: Date.now },
    transactions: { type: [BiggiHouseWalletTransactionSchema], default: [] },
  },
  { timestamps: true }
);

const BiggiHouseWallet = mongoose.model("BiggiHouseWallet", biggiHouseWalletSchema);
export default BiggiHouseWallet;

