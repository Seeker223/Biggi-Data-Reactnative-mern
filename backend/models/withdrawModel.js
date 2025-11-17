import mongoose from "mongoose";

const withdrawSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    method: {
      type: String,
      enum: ["Opay", "Bank Transfer"],
      required: true,
    },
    bank: { type: String },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Withdraw", withdrawSchema);
