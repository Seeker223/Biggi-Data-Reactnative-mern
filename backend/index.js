// index.js

import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import "dotenv/config";

import job from "./utils/cron.js";

// Route files
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import walletRoutes from "./routes/walletRoutes.js";
import monnifyRoutes from "./routes/monnifyRoutes.js";

// ✅ IMPORT THE WEBHOOK FUNCTION (you forgot this)
import { monnifyWebhook } from "./controllers/monnifyController.js";

// Error handler
const { default: errorHandler } = await import('./middleware/error.js');

const app = express();

// Render config
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// Database connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected 🚀"))
  .catch((err) => {
    console.error("MongoDB Error:", err.message);
    process.exit(1);
  });

// -------------------------------------
// 🔴 CRITICAL — Webhook MUST come before express.json()
// -------------------------------------

app.post(
  "/api/monnify/webhook",
  express.raw({ type: "*/*" }),
  monnifyWebhook
);

// Standard middlewares
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
app.use(hpp());

// CORS
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.startsWith("exp://")) return callback(null, true);

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

// Health check
app.get("/", (req, res) => {
  res.send("API is running... OK");
});

// Ping
app.get("/api/v1/auth/ping", (req, res) => {
  res.json({
    success: true,
    message: "Backend is alive",
    time: new Date().toISOString(),
  });
});

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/wallet", walletRoutes);

// Monnify routes (create account, manual credit)
app.use("/api/monnify", monnifyRoutes);


// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.originalUrl}`,
  });
});

// Error handler
app.use(errorHandler);

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.log(`Unhandled Error: ${err.message}`);
  server.close(() => process.exit(1));
});
