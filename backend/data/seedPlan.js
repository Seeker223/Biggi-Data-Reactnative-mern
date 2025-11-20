// backend/data/seedPlan.js
import "dotenv/config.js";
import mongoose from "mongoose";
import DataPlan from "../models/DataPlan.js";

const plans = [
  // ============================
  // MTN DATA BUNDLES
  // ============================
  { network: "mtn", category: "SME", plan_id: "mtnsme_500", zenipoint_code: "mtnsme_500", name: "MTN SME 500MB", amount: 150 },
  { network: "mtn", category: "SME", plan_id: "mtnsme_1", zenipoint_code: "mtnsme_1", name: "MTN SME 1GB", amount: 300 },
  { network: "mtn", category: "SME", plan_id: "mtnsme_2", zenipoint_code: "mtnsme_2", name: "MTN SME 2GB", amount: 600 },
  { network: "mtn", category: "SME", plan_id: "mtnsme_3", zenipoint_code: "mtnsme_3", name: "MTN SME 3GB", amount: 900 },
  { network: "mtn", category: "SME", plan_id: "mtnsme_5", zenipoint_code: "mtnsme_5", name: "MTN SME 5GB", amount: 1500 },
  { network: "mtn", category: "SME", plan_id: "mtnsme_10", zenipoint_code: "mtnsme_10", name: "MTN SME 10GB", amount: 3000 },

  { network: "mtn", category: "SME2", plan_id: "mtnsme2_500", zenipoint_code: "mtnsme2_500", name: "MTN SME2 500MB", amount: 160 },
  { network: "mtn", category: "SME2", plan_id: "mtnsme2_1", zenipoint_code: "mtnsme2_1", name: "MTN SME2 1GB", amount: 320 },
  { network: "mtn", category: "SME2", plan_id: "mtnsme2_2", zenipoint_code: "mtnsme2_2", name: "MTN SME2 2GB", amount: 600 },
  { network: "mtn", category: "SME2", plan_id: "mtnsme2_3", zenipoint_code: "mtnsme2_3", name: "MTN SME2 3GB", amount: 900 },
  { network: "mtn", category: "SME2", plan_id: "mtnsme2_5", zenipoint_code: "mtnsme2_5", name: "MTN SME2 5GB", amount: 1500 },
  { network: "mtn", category: "SME2", plan_id: "mtnsme2_10", zenipoint_code: "mtnsme2_10", name: "MTN SME2 10GB", amount: 3000 },

  { network: "mtn", category: "CG", plan_id: "mtncg_500", zenipoint_code: "mtncg_500", name: "MTN CG 500MB", amount: 160 },
  { network: "mtn", category: "CG", plan_id: "mtncg_1", zenipoint_code: "mtncg_1", name: "MTN CG 1GB", amount: 320 },
  { network: "mtn", category: "CG", plan_id: "mtncg_2", zenipoint_code: "mtncg_2", name: "MTN CG 2GB", amount: 600 },
  { network: "mtn", category: "CG", plan_id: "mtncg_3", zenipoint_code: "mtncg_3", name: "MTN CG 3GB", amount: 900 },
  { network: "mtn", category: "CG", plan_id: "mtncg_5", zenipoint_code: "mtncg_5", name: "MTN CG 5GB", amount: 1500 },
  { network: "mtn", category: "CG", plan_id: "mtncg_10", zenipoint_code: "mtncg_10", name: "MTN CG 10GB", amount: 3000 },

  // ============================
  // GLO DATA
  // ============================
  { network: "glo", category: "DATA", plan_id: "glo_105", zenipoint_code: "glo_105", name: "GLO 1.05GB", amount: 150 },
  { network: "glo", category: "DATA", plan_id: "glo_29", zenipoint_code: "glo_29", name: "GLO 2.5GB", amount: 300 },
  { network: "glo", category: "DATA", plan_id: "glo_41", zenipoint_code: "glo_41", name: "GLO 4.5GB", amount: 500 },
  { network: "glo", category: "DATA", plan_id: "glo_58", zenipoint_code: "glo_58", name: "GLO 5.8GB", amount: 700 },
  { network: "glo", category: "DATA", plan_id: "glo_77", zenipoint_code: "glo_77", name: "GLO 7.7GB", amount: 900 },
  { network: "glo", category: "DATA", plan_id: "glo_10", zenipoint_code: "glo_10", name: "GLO 10GB", amount: 1200 },
  { network: "glo", category: "DATA", plan_id: "glo_1325", zenipoint_code: "glo_1325", name: "GLO 13.25GB", amount: 1500 },
  { network: "glo", category: "DATA", plan_id: "glo_1825", zenipoint_code: "glo_1825", name: "GLO 18.25GB", amount: 2000 },
  { network: "glo", category: "DATA", plan_id: "glo_295", zenipoint_code: "glo_295", name: "GLO 29GB", amount: 3200 },
  { network: "glo", category: "DATA", plan_id: "glo_50", zenipoint_code: "glo_50", name: "GLO 50GB", amount: 5000 },
  { network: "glo", category: "DATA", plan_id: "glo_93", zenipoint_code: "glo_93", name: "GLO 93GB", amount: 9000 },

  // ============================
  // AIRTEL DATA
  // ============================
  { network: "airtel", category: "DATA", plan_id: "airtel_750", zenipoint_code: "airtel_750", name: "Airtel 750MB", amount: 150 },
  { network: "airtel", category: "DATA", plan_id: "airtel_15", zenipoint_code: "airtel_15", name: "Airtel 1.5GB", amount: 300 },
  { network: "airtel", category: "DATA", plan_id: "airtel_2", zenipoint_code: "airtel_2", name: "Airtel 2GB", amount: 600 },
  { network: "airtel", category: "DATA", plan_id: "airtel_3", zenipoint_code: "airtel_3", name: "Airtel 3GB", amount: 900 },
  { network: "airtel", category: "DATA", plan_id: "airtel_45", zenipoint_code: "airtel_45", name: "Airtel 4.5GB", amount: 1200 },
  { network: "airtel", category: "DATA", plan_id: "airtel_6", zenipoint_code: "airtel_6", name: "Airtel 6GB", amount: 1500 },
  { network: "airtel", category: "DATA", plan_id: "airtel_11", zenipoint_code: "airtel_11", name: "Airtel 11GB", amount: 2500 },
  { network: "airtel", category: "DATA", plan_id: "airtel_40", zenipoint_code: "airtel_40", name: "Airtel 40GB", amount: 8000 },
  { network: "airtel", category: "DATA", plan_id: "airtel_75", zenipoint_code: "airtel_75", name: "Airtel 75GB", amount: 15000 },

  // ============================
  // 9MOBILE / ETISALAT
  // ============================
  { network: "etisalat", category: "SME", plan_id: "eti_1", zenipoint_code: "mobile_1", name: "9Mobile SME 1GB", amount: 280 },
  { network: "etisalat", category: "CG", plan_id: "eti_cg_500", zenipoint_code: "mobile_500", name: "9Mobile CG 500MB", amount: 140 },
];

// ============================
// SEED SCRIPT
// ============================
const seed = async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI not found in .env");

    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✔ Connected to MongoDB");

    await DataPlan.deleteMany();
    console.log("✔ Old plans removed");

    await DataPlan.insertMany(plans);
    console.log("✔ All plans inserted successfully");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
};

seed();
