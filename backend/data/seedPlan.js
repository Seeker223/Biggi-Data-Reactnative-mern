// backend/data/seedPlans.js
import mongoose from "mongoose";
import DataPlan from "../models/DataPlan.js";
import "dotenv/config.js";

const plans = [
  // ============================
  // MTN SME
  // ============================
  {
    network: "mtn",
    category: "SME",
    plan_id: "mtn_sme_500",
    zenipoint_code: "MTN500SME",
    name: "MTN SME 500MB",
    amount: 150,
  },
  {
    network: "mtn",
    category: "SME",
    plan_id: "mtn_sme_1gb",
    zenipoint_code: "MTN1GBSME",
    name: "MTN SME 1GB",
    amount: 300,
  },
  {
    network: "mtn",
    category: "SME",
    plan_id: "mtn_sme_2gb",
    zenipoint_code: "MTN2GBSME",
    name: "MTN SME 2GB",
    amount: 600,
  },

  // ============================
  // MTN GIFTING
  // ============================
  {
    network: "mtn",
    category: "GIFTING",
    plan_id: "mtn_gift_1gb",
    zenipoint_code: "MTN1GBGIFT",
    name: "MTN Gifting 1GB",
    amount: 350,
  },

  // ============================
  // AIRTEL SME
  // ============================
  {
    network: "airtel",
    category: "SME",
    plan_id: "airtel_sme_1gb",
    zenipoint_code: "AIRTEL1GBSME",
    name: "Airtel SME 1GB",
    amount: 320,
  },

  // ============================
  // GLO SME
  // ============================
  {
    network: "glo",
    category: "SME",
    plan_id: "glo_sme_1gb",
    zenipoint_code: "GLO1GBSME",
    name: "GLO SME 1GB",
    amount: 280,
  },

  // ============================
  // 9MOBILE SME
  // ============================
  {
    network: "etisalat",
    category: "SME",
    plan_id: "etisalat_sme_1gb",
    zenipoint_code: "9MOBILE1GBSME",
    name: "9mobile SME 1GB",
    amount: 300,
  },
];

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    await DataPlan.deleteMany();
    console.log("Old plans removed");

    await DataPlan.insertMany(plans);
    console.log("✔ Plans inserted successfully");

    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
