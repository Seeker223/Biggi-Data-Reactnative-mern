// backend/models/DataPlan.js
import mongoose from "mongoose";

const DataPlanSchema = new mongoose.Schema(
  {
    plan_id: { type: String, required: true, unique: true }, // e.g. mtn_sme_1gb
    name: { type: String, required: true }, // MTN SME 1GB
    network: { type: String, required: true }, // mtn, glo, airtel
    category: { type: String, required: true }, // sme, gift, corporate
    amount: { type: Number, required: true },
    validity: { type: String, default: "30 days" },

    // LIVE Zenipoint Code
    zenipoint_code: { type: String, default: null }, // actual plan code from Zenipoint

    // optional flags
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("DataPlan", DataPlanSchema);
