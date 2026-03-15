// backend/data/seedPlan.js
import "dotenv/config.js";
import mongoose from "mongoose";
import DataPlan from "../models/DataPlan.js";
import { providerPlanCatalog } from "./providerPlanCatalog.js";

// IMPORTANT: this seed only loads the exact Zenipoint code+price catalog.
// This prevents mismatches where UI price differs from provider plan code/amount.
const plans = providerPlanCatalog;

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

    console.log("Connected to MongoDB");

    await DataPlan.deleteMany();
    console.log("Old plans removed");

    await DataPlan.insertMany(plans);
    console.log("All plans inserted successfully");

    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  }
};

seed();
