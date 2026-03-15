// backend/models/DataPlan.js
import mongoose from "mongoose";

const DataPlanSchema = new mongoose.Schema(
  {
    plan_id: { type: String, required: true, unique: true }, // e.g. mtn_sme_1gb
    name: { type: String, required: true }, // MTN SME 1GB
    network: { type: String, required: true }, // mtn, glo, airtel
    category: { type: String, required: true }, // sme, gift, corporate
    // What BiggiData charges users for this plan.
    amount: { type: Number, required: true },
    validity: { type: String, default: "30 days" },

    // LIVE Zenipoint Code
    zenipoint_code: { type: String, default: null }, // actual plan code from Zenipoint

    // Provider cost (what Zenipoint charges BiggiData). Used for profit tracking.
    // If not provided, we try to extract provider amount from Zenipoint response where possible.
    provider_amount: { type: Number, default: null },

    // Default markup/profit per plan (optional; informational).
    markup: { type: Number, default: 100 },

    // optional flags
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("DataPlan", DataPlanSchema);
