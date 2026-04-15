import mongoose from "mongoose";

const biggiHouseHouseSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true, min: 1, max: 10 },
    minimum: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

biggiHouseHouseSchema.index({ number: 1 }, { unique: true });

const BiggiHouseHouse = mongoose.model("BiggiHouseHouse", biggiHouseHouseSchema);
export default BiggiHouseHouse;

