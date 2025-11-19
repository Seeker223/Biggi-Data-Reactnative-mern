import express from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import hpp from "hpp";
import "dotenv/config";

console.log("Zeni API KEY =>", process.env.ZENI_API_KEY);
console.log("Zeni CONTRACT KEY =>", process.env.ZENI_CONTRACT_KEY);


import job from "./utils/cron.js";

// Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import monnifyRoutes from "./routes/monnifyRoutes.js";
import dailyGameRoutes from "./routes/dailyGameRoutes.js";
import dataRoutes from "./routes/dataBundleRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import dataPurchaseRoutes from "./routes/dataPurchaseRoutes.js";



// Monnify webhook (must NOT be inside router)
import { monnifyWebhook } from "./controllers/monnifyController.js";

// Error middleware
const { default: errorHandler } = await import("./middleware/error.js");

const app = express();

// Server config
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// -------------------------------
// ⛔ CONNECT DATABASE
// -------------------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected 🚀"))
  .catch((err) => {
    console.error("MongoDB Error:", err.message);
    process.exit(1);
  });

// ------------------------------------------------------------
// ⚠️ CRITICAL — Webhook MUST be placed BEFORE express.json()
// And MUST use express.raw() not json()
// ------------------------------------------------------------
app.post(
  "/api/monnify/webhook",
  express.raw({ type: "*/*" }),
  monnifyWebhook
);

// -------------------------------
// GLOBAL MIDDLEWARES
// -------------------------------
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(helmet());
app.use(hpp());

// -------------------------------
// CORS CONFIG
// -------------------------------
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // mobile device

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

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("API is running... OK");
});

// Authentication Ping
app.get("/api/v1/auth/ping", (req, res) => {
  res.json({
    success: true,
    message: "Backend is alive",
    time: new Date().toISOString(),
  });
});

// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);

// 💳 Wallet routes (includes initiate-monnify-payment)
app.use("/api/v1/wallet", walletRoutes);

// Monnify additional routes (if any: static accounts, manual credit)
app.use("/api/v1/monnify", monnifyRoutes);
app.use("/api/v1/daily-game", dailyGameRoutes);

app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/data", dataPurchaseRoutes);

app.use("/api/v1/data", dataRoutes);// -------------------------------
// 404 Handler
// -------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.originalUrl}`,
  });
});

// -------------------------------
// GLOBAL ERROR HANDLER
// -------------------------------
app.use(errorHandler);

// -------------------------------
// START SERVER
// -------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// -------------------------------
// CRASH SAFETY
// -------------------------------
process.on("unhandledRejection", (err) => {
  console.log(`Unhandled Error: ${err.message}`);
  server.close(() => process.exit(1));
});
