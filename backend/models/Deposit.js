import mongoose from "mongoose";

const depositSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "successful", "failed"],
      default: "pending",
    },

    channel: {
      type: String,
      enum: ["flutterwave"],
      default: "flutterwave",
    },

    flutterwaveTransactionId: {
      type: String,
      default: null,
    },

    gatewayResponse: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("Deposit", depositSchema);
