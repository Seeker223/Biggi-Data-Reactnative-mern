// models/DataPlan.js
import mongoose from "mongoose";

const dataPlanSchema = new mongoose.Schema(
  {
    network: {
      type: String,
      required: true,
      enum: ["mtn", "glo", "airtel", "etisalat"],
    },

    category: {
      type: String,
      required: true,
      enum: ["SME", "GIFTING", "CG"],
    },

    plan_id: {
      type: String,
      required: true,
      unique: true,
    },

    zenipoint_code: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("DataPlan", dataPlanSchema);
