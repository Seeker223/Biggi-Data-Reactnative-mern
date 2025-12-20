// backend/index.js
import express from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import hpp from "hpp";
import "dotenv/config";

/* ---------------- CRON JOB ---------------- */
import job from "./utils/cron.js";

/* ---------------- CONTROLLERS ---------------- */
import { flutterwaveWebhook } from "./controllers/flutterwaveController.js";

/* ---------------- ROUTES ---------------- */
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import dailyGameRoutes from "./routes/dailyGameRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import dataPurchaseRoutes from "./routes/dataPurchaseRoutes.js";

/* ---------------- DEBUG ---------------- */
import DataPlan from "./models/DataPlan.js";

/* ---------------- ERROR HANDLER ---------------- */
import errorHandler from "./middleware/error.js";

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

/* ----------------------------------------
   🔌 CONNECT MONGO WITH ENHANCED CONFIG
---------------------------------------- */
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("❌ MONGO_URI is not defined in environment variables");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log("✅ MongoDB Connected Successfully 🚀");
    
    // Test connection
    await mongoose.connection.db.admin().ping();
    console.log("✅ MongoDB Ping Successful");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
};

connectDB();

/* ----------------------------------------
   MONGOOSE CONNECTION EVENTS
---------------------------------------- */
mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB Connection Error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB Disconnected");
});

mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB Reconnected");
});

/* ----------------------------------------
   🚨 CRITICAL: WEBHOOK ROUTE MUST COME BEFORE ANY OTHER MIDDLEWARE
   Flutterwave webhook requires raw body for signature verification
---------------------------------------- */
app.post(
  "/api/v1/wallet/flutterwave-webhook",
  express.raw({ type: "application/json" }),
  flutterwaveWebhook
);

/* ----------------------------------------
   GLOBAL MIDDLEWARES (AFTER WEBHOOK)
---------------------------------------- */
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Disable CSP for simplicity
}));

app.use(hpp());

/* ----------------------------------------
   CORS CONFIGURATION - SIMPLIFIED
---------------------------------------- */
const allowedOrigins = [
  "http://localhost:8081",
  "http://localhost:3000",
  "http://localhost:19006",
  "exp://192.168.*.*:8081",
  "https://biggi-data-frontend.vercel.app",
];

// Custom CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow requests with no origin or from allowed origins
  if (!origin || 
      origin.startsWith("exp://") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")) {
    
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", 
      "Content-Type, Authorization, X-Requested-With, Accept, Origin, verif-hash"
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    
    // Handle preflight requests
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
  } else {
    console.warn(`⚠️ CORS Blocked: ${origin}`);
  }
  
  next();
});

// Regular middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

/* ----------------------------------------
   REQUEST LOGGING MIDDLEWARE
---------------------------------------- */
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📥 [${requestId}] ${req.method} ${req.url}`);
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`📤 [${requestId}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  
  next();
});

/* ----------------------------------------
   HEALTH CHECKS
---------------------------------------- */
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Biggi Data API is running...",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/api/v1/auth/ping", (req, res) => {
  res.json({
    success: true,
    message: "Backend alive",
    time: new Date().toISOString(),
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.get("/health", async (req, res) => {
  try {
    // Check MongoDB
    await mongoose.connection.db.admin().ping();
    
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        mongodb: "connected",
        server: "running",
      },
      environment: process.env.NODE_ENV,
      memory: process.memoryUsage(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({
      success: false,
      status: "unhealthy",
      error: error.message,
    });
  }
});

/* ----------------------------------------
   DEBUG ROUTES (PROTECT IN PRODUCTION)
---------------------------------------- */
if (process.env.NODE_ENV !== "production") {
  app.get("/debug/plans", async (req, res) => {
    try {
      const plans = await DataPlan.find();
      res.json({ success: true, count: plans.length, plans });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  app.get("/debug/env", (req, res) => {
    const safeEnv = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MONGO_URI: process.env.MONGO_URI ? "Set" : "Not set",
      FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY ? "Set" : "Not set",
      FLUTTERWAVE_WEBHOOK_SECRET: process.env.FLUTTERWAVE_WEBHOOK_SECRET ? "Set" : "Not set",
      JWT_SECRET: process.env.JWT_SECRET ? "Set" : "Not set",
    };
    res.json({ success: true, environment: safeEnv });
  });
}

/* ----------------------------------------
   MAIN ROUTES
---------------------------------------- */
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/user", profileRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/daily-game", dailyGameRoutes);
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/data", dataPurchaseRoutes);

/* ----------------------------------------
   WEBHOOK TESTING ENDPOINT (DEVELOPMENT ONLY)
---------------------------------------- */
if (process.env.NODE_ENV !== "production") {
  app.post("/test/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      console.log("🔧 Test webhook received:", {
        headers: req.headers,
        body: req.body.toString(),
      });
      
      res.json({
        success: true,
        message: "Test webhook received",
        note: "Real webhook: /api/v1/wallet/flutterwave-webhook"
      });
    } catch (error) {
      console.error("Test webhook error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

/* ----------------------------------------
   404 HANDLER
---------------------------------------- */
app.use((req, res) => {
  console.warn(`❌ 404 Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  });
});

/* ----------------------------------------
   GLOBAL ERROR HANDLER
---------------------------------------- */
app.use(errorHandler);

/* ----------------------------------------
   START SERVER WITH GRACEFUL SHUTDOWN
---------------------------------------- */
const server = app.listen(PORT, HOST, () => {
  console.log(`
  🚀 Server Information:
  ======================
  ✅ Environment: ${process.env.NODE_ENV || "development"}
  ✅ Host: ${HOST}
  ✅ Port: ${PORT}
  ✅ MongoDB: ${mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"}
  ✅ Webhook: http://${HOST}:${PORT}/api/v1/wallet/flutterwave-webhook
  ✅ Health: http://${HOST}:${PORT}/health
  ✅ Time: ${new Date().toISOString()}
  `);
  
  // Start cron job if exists
  if (job) {
    console.log("✅ Cron job initialized");
  }
});

/* ----------------------------------------
   GRACEFUL SHUTDOWN
---------------------------------------- */
const shutdown = async (signal) => {
  console.log(`\n⚠️  Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Close server
    server.close(() => {
      console.log("✅ HTTP server closed");
    });
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log("✅ MongoDB connection closed");
    
    console.log("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};

// Handle termination signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ----------------------------------------
   UNHANDLED ERROR HANDLING
---------------------------------------- */
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit in production, just log
  if (process.env.NODE_ENV === "production") {
    console.error("Continuing despite unhandled rejection");
  }
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  // In production, we might want to restart the process
  if (process.env.NODE_ENV === "production") {
    console.error("Restarting due to uncaught exception");
    process.exit(1);
  }
});

// Keep-alive headers for load balancers
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default app;