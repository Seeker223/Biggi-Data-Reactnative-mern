import mongoose from "mongoose";

const depositCreditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    source: {
      type: String,
      enum: ["verify", "webhook", "reconcile"],
      required: true,
    },
    note: {
      type: String,
      default: "",
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("DepositCreditLog", depositCreditLogSchema);
