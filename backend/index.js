import express from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import hpp from "hpp";
import "dotenv/config";
import { startMonnifyPolling } from "./utils/monnifyPoller.js";

console.log("Zeni API KEY =>", process.env.ZENI_API_KEY);
console.log("Zeni CONTRACT KEY =>", process.env.ZENI_CONTRACT_KEY);

// Cron job
import job from "./utils/cron.js";

// Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import monnifyRoutes from "./routes/monnifyRoutes.js";
import dailyGameRoutes from "./routes/dailyGameRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";


// NEW plan + data purchase routes
import planRoutes from "./routes/planRoutes.js";
import dataPurchaseRoutes from "./routes/dataPurchaseRoutes.js";

// Debug helper
import DataPlan from "./models/DataPlan.js";

// Monnify webhook (must NOT be inside router)
import { monnifyWebhook } from "./controllers/monnifyController.js";

// Error middleware
const { default: errorHandler } = await import("./middleware/error.js");

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// ----------------------------------------
// 🔌 CONNECT MONGO
// ----------------------------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected 🚀"))
  .catch((err) => {
    console.error("MongoDB Error:", err.message);
    process.exit(1);
  });

// ------------------------------------------------------------
// 🚨 MONNIFY WEBHOOK — MUST BE BEFORE express.json()
// ------------------------------------------------------------
app.post(
  "/api/monnify/webhook",
  express.raw({ type: "application/json" }),
  monnifyWebhook
);

// ------------------------------------------------------------
// 🔍 DEBUG: Check data plans in DB
// ------------------------------------------------------------
app.get("/check-plans", async (req, res) => {
  try {
    const plans = await DataPlan.find();
    res.json({ success: true, plans });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ----------------------------------------
// GLOBAL MIDDLEWARES
// ----------------------------------------
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(helmet());
app.use(hpp());

// ----------------------------------------
// CORS CONFIG
// ----------------------------------------
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Mobile / Postman / CLI

      if (origin.startsWith("exp://")) return callback(null, true); // Expo Go

      const allowedOrigins = [
        "http://localhost:8081",
        "http://localhost:3000",
        "https://biggi-data-frontend.vercel.app",
      ];

      if (allowedOrigins.includes(origin)) return callback(null, true);

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);

// ----------------------------------------
// HEALTH ROUTES
// ----------------------------------------
app.get("/", (req, res) => {
  res.send("API is running... OK");
});

app.get("/api/v1/auth/ping", (req, res) => {
  res.json({
    success: true,
    message: "Backend alive",
    time: new Date().toISOString(),
  });
});

// ----------------------------------------
// MAIN ROUTES
// ----------------------------------------
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);

app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/monnify", monnifyRoutes);
app.use("/api/v1/daily-game", dailyGameRoutes);
app.use("/api/v1/user", profileRoutes);


// ⭐ NEW — DB-BASED DATA PLAN LISTING
app.use("/api/v1/plans", planRoutes);

// ⭐ NEW — ZENIPOINT DATA PURCHASE
app.use("/api/v1/data", dataPurchaseRoutes);

// ⚠️ REMOVED — old local-JSON dataBundleRoutes
// app.use("/api/v1/data/plans", dataRoutes);  <-- DELETED COMPLETELY

// ----------------------------------------
// 404 HANDLER
// ----------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.originalUrl}`,
  });
});


startMonnifyPolling();


// ----------------------------------------
// GLOBAL ERROR HANDLER
// ----------------------------------------
app.use(errorHandler);

// ----------------------------------------
// START SERVER
// ----------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// ----------------------------------------
// CRASH SAFETY
// ----------------------------------------
process.on("unhandledRejection", (err) => {
  console.log(`Unhandled Error: ${err.message}`);
  server.close(() => process.exit(1));
});
