import mongoose from "mongoose";

const biggiHouseVendorRequestSchema = new mongoose.Schema(
  {
    requesterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    phoneNumber: { type: String, required: true, trim: true },
    network: { type: String, default: null },
    planId: { type: String, default: null },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

biggiHouseVendorRequestSchema.index({ vendorUserId: 1, createdAt: -1 });

const BiggiHouseVendorRequest = mongoose.model(
  "BiggiHouseVendorRequest",
  biggiHouseVendorRequestSchema
);
export default BiggiHouseVendorRequest;

