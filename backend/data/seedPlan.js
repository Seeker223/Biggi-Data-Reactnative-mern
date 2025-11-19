import mongoose from "mongoose";
import dotenv from "dotenv";
import DataPlan from "../models/DataPlan.js";

dotenv.config();

const plans = [
  {
    plan_id: "mtnsme_1",
    name: "MTN SME 1GB",
    amount: 300,
    network: "mtn",
    category: "SME",
    zenipoint_code: "MTN_SME_1GB"
  },
  {
    plan_id: "mtnsme_500",
    name: "MTN SME 500MB",
    amount: 150,
    network: "mtn",
    category: "SME",
    zenipoint_code: "MTN_SME_500MB"
  },
  {
    plan_id: "mtnsme_2",
    name: "MTN SME 2GB",
    amount: 600,
    network: "mtn",
    category: "SME",
    zenipoint_code: "MTN_SME_2GB"
  }
  // Add all your other Airtel, Glo, Etisalat plans here
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    await DataPlan.deleteMany();
    await DataPlan.insertMany(plans);

    console.log("Plans seeded successfully.");
    process.exit(0);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
};

seed();
