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
      unique: true, // Internal unique ID (e.g. mtnsme_1)
    },

    zenipoint_code: {
      type: String,
      required: true, // The actual PLAN_CODE Zenipoint needs (e.g. 1000)
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
