import mongoose from "mongoose";

const biggiHouseMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    houseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BiggiHouseHouse",
      required: true,
      index: true,
    },
    joinedAt: { type: Date, default: Date.now },
    lastPaidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

biggiHouseMembershipSchema.index({ userId: 1, houseId: 1 }, { unique: true });

const BiggiHouseMembership = mongoose.model(
  "BiggiHouseMembership",
  biggiHouseMembershipSchema
);
export default BiggiHouseMembership;

