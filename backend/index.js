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
import monthlyGameRoutes from "./routes/monthlyGameRoutes.js"; // NEW
import profileRoutes from "./routes/profileRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import dataPurchaseRoutes from "./routes/dataPurchaseRoutes.js";
import gameStatsRoutes from "./routes/gameStatsRoutes.js"; // NEW

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
    version: "2.0.0", // Updated version
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: {
      authentication: true,
      wallet: true,
      daily_games: true,
      monthly_games: true, // NEW
      data_purchase: true,
      flutterwave_payments: true,
    }
  });
});

app.get("/api/v1/auth/ping", (req, res) => {
  res.json({
    success: true,
    message: "Backend alive",
    time: new Date().toISOString(),
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    version: "2.0.0",
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
        cron_job: job ? "active" : "inactive",
      },
      environment: process.env.NODE_ENV,
      memory: process.memoryUsage(),
      version: "2.0.0",
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
  
  app.get("/debug/routes", (req, res) => {
    const routes = [
      { path: "/api/v1/auth", description: "Authentication routes" },
      { path: "/api/v1/users", description: "User management" },
      { path: "/api/v1/user", description: "User profile" },
      { path: "/api/v1/wallet", description: "Wallet & payments" },
      { path: "/api/v1/daily-game", description: "Daily games" },
      { path: "/api/v1/monthly-game", description: "Monthly games (NEW)" },
      { path: "/api/v1/game-stats", description: "Game statistics (NEW)" },
      { path: "/api/v1/plans", description: "Data plans" },
      { path: "/api/v1/data", description: "Data purchase" },
    ];
    res.json({ success: true, routes });
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
app.use("/api/v1/monthly-game", monthlyGameRoutes); // NEW: Monthly game routes
app.use("/api/v1/game-stats", gameStatsRoutes); // NEW: Game statistics routes
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/data", dataPurchaseRoutes);

/* ----------------------------------------
   GAME RULES AND INFORMATION ROUTES
---------------------------------------- */
app.get("/api/v1/game/rules/daily", (req, res) => {
  res.json({
    success: true,
    rules: {
      title: "Daily Draw Rules",
      prize: "₦2,000",
      draw_time: "7:30 PM daily",
      ticket_requirement: "1 ticket per play",
      ticket_source: "Free with data purchase",
      number_selection: "Select 5 numbers from 1-70",
      win_condition: "Match all 5 numbers",
      max_plays_per_day: "Unlimited (with tickets)",
      claim_period: "24 hours after draw",
    }
  });
});

app.get("/api/v1/game/rules/monthly", (req, res) => {
  res.json({
    success: true,
    rules: {
      title: "Monthly Draw Rules",
      prize: "₦5,000",
      draw_time: "End of month (23:59)",
      eligibility: "5+ data purchases in the month",
      qualification: "Automatic with eligibility",
      selection: "Random draw from eligible players",
      win_condition: "Random selection",
      claim_period: "7 days after draw",
      monthly_reset: "Purchases reset every month",
    }
  });
});

app.get("/api/v1/game/schedules", (req, res) => {
  res.json({
    success: true,
    schedules: {
      daily: {
        time: "19:30",
        timezone: "WAT",
        recurring: "daily",
        prize: "₦2,000",
        next_draw: new Date(new Date().setHours(19, 30, 0, 0)).toISOString(),
      },
      monthly: {
        time: "23:59",
        timezone: "WAT",
        recurring: "monthly",
        prize: "₦5,000",
        next_draw: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 0, 0).toISOString(),
      },
    }
  });
});

app.get("/api/v1/game/prizes/daily", (req, res) => {
  res.json({
    success: true,
    prizes: [
      { match: "5 numbers", prize: "₦2,000", winners: "1 per day" },
      { match: "4 numbers", prize: "₦500", winners: "5 per day" },
      { match: "3 numbers", prize: "₦200", winners: "10 per day" },
    ]
  });
});

app.get("/api/v1/game/prizes/monthly", (req, res) => {
  res.json({
    success: true,
    prizes: [
      { type: "Grand Prize", prize: "₦5,000", winners: "1 per month" },
      { type: "Consolation", prize: "₦1,000", winners: "5 per month" },
    ]
  });
});

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
  
  // Test monthly game endpoint
  app.get("/test/monthly-eligibility", async (req, res) => {
    try {
      // Simulate monthly eligibility check
      const mockData = {
        success: true,
        eligibility: {
          purchases: Math.floor(Math.random() * 10),
          required: 5,
          progress: Math.floor(Math.random() * 100),
          isEligible: Math.random() > 0.5,
          isWinner: Math.random() > 0.7,
          prizeAmount: 5000,
          claimed: false,
          month: "2024-12",
          daysLeft: Math.floor(Math.random() * 30),
          drawDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 0, 0).toISOString(),
        }
      };
      res.json(mockData);
    } catch (error) {
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
    available_routes: [
      "/api/v1/auth/*",
      "/api/v1/wallet/*",
      "/api/v1/daily-game/*",
      "/api/v1/monthly-game/*",
      "/api/v1/game-stats/*",
      "/api/v1/plans/*",
      "/api/v1/data/*",
      "/health",
    ]
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
  ✅ Version: 2.0.0
  ✅ New Features: Monthly Games ✓ Game Statistics ✓
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