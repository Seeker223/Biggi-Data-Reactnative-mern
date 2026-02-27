// backend/index.js - UPDATED WITH ENHANCED DEBUGGING & RESEND
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
import monthlyGameRoutes from "./routes/monthlyGameRoutes.js";
import topRandomMonthlyRoutes from "./routes/topRandomMonthlyRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import dataPurchaseRoutes from "./routes/dataPurchaseRoutes.js";
import gameStatsRoutes from "./routes/gameStatsRoutes.js";

/* ---------------- DEBUG ---------------- */
import DataPlan from "./models/DataPlan.js";

/* ---------------- ERROR HANDLER ---------------- */
import errorHandler from "./middleware/error.js";

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

/* ----------------------------------------
   ðŸ”Œ CONNECT MONGO WITH ENHANCED CONFIG
---------------------------------------- */
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("âŒ MONGO_URI is not defined in environment variables");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log("âœ… MongoDB Connected Successfully ðŸš€");
    
    // Test connection
    await mongoose.connection.db.admin().ping();
    console.log("âœ… MongoDB Ping Successful");
  } catch (err) {
    console.error("âŒ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
};

connectDB();

/* ----------------------------------------
   MONGOOSE CONNECTION EVENTS
---------------------------------------- */
mongoose.connection.on("error", (err) => {
  console.error("âŒ MongoDB Connection Error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("âš ï¸ MongoDB Disconnected");
});

mongoose.connection.on("reconnected", () => {
  console.log("âœ… MongoDB Reconnected");
});

/* ----------------------------------------
   ðŸš¨ CRITICAL: WEBHOOK ROUTE MUST COME BEFORE ANY OTHER MIDDLEWARE
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
  contentSecurityPolicy: false,
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

const isPrivateLanOrigin = (origin = "") => {
  return /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(origin);
};

// Custom CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (!origin || 
      origin.startsWith("exp://") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      isPrivateLanOrigin(origin) ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")) {
    
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", 
      "Content-Type, Authorization, X-Requested-With, Accept, Origin, verif-hash"
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
  } else {
    console.warn(`âš ï¸ CORS Blocked: ${origin}`);
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
  
  console.log(`ðŸ“¥ [${requestId}] ${req.method} ${req.url}`);
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`ðŸ“¤ [${requestId}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
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
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: {
      authentication: true,
      wallet: true,
      daily_games: true,
      monthly_games: true,
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
  
  // UPDATED: Enhanced environment debug endpoint with Resend
  app.get("/debug/env", (req, res) => {
    const safeEnv = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MONGO_URI: process.env.MONGO_URI ? "âœ… Set" : "âŒ Not set",
      BASE_URL: process.env.BASE_URL || "Not set (using localhost:5000)",
      FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY 
        ? `âœ… Set (${process.env.FLUTTERWAVE_SECRET_KEY.substring(0, 8)}...)` 
        : "âŒ Not set",
      FLUTTERWAVE_PUBLIC_KEY: process.env.FLUTTERWAVE_PUBLIC_KEY 
        ? `âœ… Set (${process.env.FLUTTERWAVE_PUBLIC_KEY.substring(0, 8)}...)` 
        : "âŒ Not set",
      FLUTTERWAVE_WEBHOOK_SECRET: process.env.FLUTTERWAVE_WEBHOOK_SECRET 
        ? "âœ… Set" 
        : "âŒ Not set",
      JWT_SECRET: process.env.JWT_SECRET ? "âœ… Set" : "âŒ Not set",
      FLUTTERWAVE_ENCRYPTION_KEY: process.env.FLUTTERWAVE_ENCRYPTION_KEY 
        ? "âœ… Set" 
        : "âŒ Not set",
      // Resend configuration
      RESEND_API_KEY: process.env.RESEND_API_KEY 
        ? `âœ… Set (${process.env.RESEND_API_KEY.substring(0, 8)}...)` 
        : "âŒ Not set",
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "Not set",
      RESEND_DOMAIN: process.env.RESEND_DOMAIN || "Not set",
    };
    
    // Check if Flutterwave keys look valid
    const flutterwaveKeyStatus = process.env.FLUTTERWAVE_SECRET_KEY 
      ? (process.env.FLUTTERWAVE_SECRET_KEY.startsWith('FLWSECK_TEST') 
         ? "âš ï¸ TEST MODE" 
         : process.env.FLUTTERWAVE_SECRET_KEY.startsWith('FLWSECK-')
           ? "âœ… LIVE MODE" 
           : "â“ UNKNOWN FORMAT")
      : "âŒ MISSING";
    
    // Check if Resend key looks valid
    const resendKeyStatus = process.env.RESEND_API_KEY 
      ? (process.env.RESEND_API_KEY.startsWith('re_')
         ? "âœ… VALID FORMAT" 
         : "â“ UNKNOWN FORMAT")
      : "âŒ MISSING";
    
    res.json({ 
      success: true, 
      environment: safeEnv,
      status: {
        flutterwave: flutterwaveKeyStatus,
        resend: resendKeyStatus,
      },
      note: "Visit /debug/flutterwave-test to test Flutterwave connection or /debug/resend-test to test Resend"
    });
  });
  
  // NEW: Resend connection test endpoint
  app.get("/debug/resend-test", async (req, res) => {
    try {
      if (!process.env.RESEND_API_KEY) {
        return res.status(400).json({
          success: false,
          message: "RESEND_API_KEY not set in environment",
          action: "Add RESEND_API_KEY to your .env file"
        });
      }
      
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      // Test Resend API by checking API key validity (without actually sending)
      const domains = await resend.domains.list();
      
      res.json({
        success: true,
        message: "âœ… Resend API connection successful",
        status: "API key is valid",
        verified_domains: domains.data ? domains.data.length : 0,
        note: domains.data && domains.data.length > 0 
          ? `Verified domains: ${domains.data.map(d => d.name).join(', ')}`
          : "No verified domains. Add and verify a domain in Resend dashboard."
      });
      
    } catch (error) {
      console.error("Resend test error:", error.message);
      
      if (error.message.includes('Unauthorized') || error.message.includes('Invalid API key')) {
        res.status(401).json({
          success: false,
          message: "âŒ Resend API key is invalid",
          error: error.message,
          action: "Check your RESEND_API_KEY in Resend dashboard"
        });
      } else if (error.message.includes('rate limit')) {
        res.status(429).json({
          success: false,
          message: "âŒ Resend rate limit exceeded",
          error: error.message,
          action: "Wait a few minutes and try again"
        });
      } else {
        res.status(500).json({
          success: false,
          message: "âŒ Resend test failed",
          error: error.message,
          action: "Check your internet connection and Resend API key"
        });
      }
    }
  });
  
  // Flutterwave connection test endpoint
  app.get("/debug/flutterwave-test", async (req, res) => {
    try {
      if (!process.env.FLUTTERWAVE_SECRET_KEY) {
        return res.status(400).json({
          success: false,
          message: "FLUTTERWAVE_SECRET_KEY not set in environment",
          action: "Add FLUTTERWAVE_SECRET_KEY to your .env file"
        });
      }
      
      // Test Flutterwave connection by making a simple API call
      const axios = await import('axios');
      const response = await axios.default.get('https://api.flutterwave.com/v3/banks/NG', {
        headers: {
          'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      res.json({
        success: true,
        message: "âœ… Flutterwave API connection successful",
        status: response.status,
        bank_count: response.data.data ? response.data.data.length : 0,
        mode: process.env.FLUTTERWAVE_SECRET_KEY.startsWith('FLWSECK_TEST') 
          ? "TEST MODE" 
          : "LIVE MODE",
        note: "If this fails, check your FLUTTERWAVE_SECRET_KEY"
      });
      
    } catch (error) {
      console.error("Flutterwave test error:", error.message);
      
      if (error.response) {
        res.status(500).json({
          success: false,
          message: "âŒ Flutterwave API test failed",
          status: error.response.status,
          error: error.response.data?.message || error.response.data,
          action: "Check your FLUTTERWAVE_SECRET_KEY and ensure it's valid"
        });
      } else if (error.request) {
        res.status(500).json({
          success: false,
          message: "âŒ Cannot reach Flutterwave servers",
          error: error.message,
          action: "Check your internet connection and firewall settings"
        });
      } else {
        res.status(500).json({
          success: false,
          message: "âŒ Flutterwave test setup error",
          error: error.message
        });
      }
    }
  });
  
  app.get("/debug/routes", (req, res) => {
    const routes = [
      { path: "/api/v1/auth", description: "Authentication routes" },
      { path: "/api/v1/users", description: "User management" },
      { path: "/api/v1/user", description: "User profile" },
      { path: "/api/v1/wallet", description: "Wallet & payments" },
      { path: "/api/v1/daily-game", description: "Daily games" },
      { path: "/api/v1/monthly-game", description: "Monthly games" },
      { path: "/api/v1/top-random-monthly", description: "Top random monthly picks" },
      { path: "/api/v1/game-stats", description: "Game statistics" },
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
app.use("/api/v1/monthly-game", monthlyGameRoutes);
app.use("/api/v1/top-random-monthly", topRandomMonthlyRoutes);
app.use("/api/v1/game-stats", gameStatsRoutes);
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/data", dataPurchaseRoutes);

/* ----------------------------------------
   GAME RULES AND INFORMATION ROUTES
---------------------------------------- */
app.get("/api/v1/game/rules/daily", (req, res) => {
  res.json({
    success: true,
    rules: {
      title: "Weekly Draw Rules",
      prize: "â‚¦2,000",
      draw_time: "Results are released at month end",
      ticket_requirement: "1 ticket per play",
      ticket_source: "Free with data purchase",
      number_selection: "Select 5 letters from A-Z then a-z (52 total)",
      win_condition: "Match all 5 numbers",
      max_plays_per_day: "Unlimited entries (with tickets)",
      claim_period: "After month-end results are released",
    }
  });
});

app.get("/api/v1/game/rules/monthly", (req, res) => {
  res.json({
    success: true,
    rules: {
      title: "Monthly Draw Rules",
      prize: "â‚¦5,000",
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
        time: "00:01",
        timezone: "WAT",
        recurring: "monthly",
        prize: "â‚¦2,000",
        next_draw: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 0, 0).toISOString(),
      },
      monthly: {
        time: "23:59",
        timezone: "WAT",
        recurring: "monthly",
        prize: "â‚¦5,000",
        next_draw: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 0, 0).toISOString(),
      },
    }
  });
});

app.get("/api/v1/game/prizes/daily", (req, res) => {
  res.json({
    success: true,
    prizes: [
      { match: "5 numbers", prize: "â‚¦2,000", winners: "1 per week" },
      { match: "4 numbers", prize: "â‚¦500", winners: "5 per week" },
      { match: "3 numbers", prize: "â‚¦200", winners: "10 per week" },
    ]
  });
});

app.get("/api/v1/game/prizes/monthly", (req, res) => {
  res.json({
    success: true,
    prizes: [
      { type: "Grand Prize", prize: "â‚¦5,000", winners: "1 per month" },
      { type: "Consolation", prize: "â‚¦1,000", winners: "5 per month" },
    ]
  });
});

/* ----------------------------------------
   WEBHOOK TESTING ENDPOINT (DEVELOPMENT ONLY)
---------------------------------------- */
if (process.env.NODE_ENV !== "production") {
  app.post("/test/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      console.log("ðŸ”§ Test webhook received:", {
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
      const mockData = {
        success: true,
        eligibility: {
          purchases: Math.floor(Math.random() * 10),
          required: 5,
          progress: Math.floor(Math.random() * 100),
          isEligible: Math.random() > 0.5,
          isWinner: Math.random() > 0.7,
          prizeAmount: 10000,
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
  console.warn(`âŒ 404 Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
    available_routes: [
      "/api/v1/auth/*",
      "/api/v1/wallet/*",
      "/api/v1/daily-game/*",
      "/api/v1/monthly-game/*",
      "/api/v1/top-random-monthly/*",
      "/api/v1/game-stats/*",
      "/api/v1/plans/*",
      "/api/v1/data/*",
      "/health",
      "/debug/env",
      "/debug/resend-test",
      "/debug/flutterwave-test"
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
  ðŸš€ Server Information:
  ======================
  âœ… Environment: ${process.env.NODE_ENV || "development"}
  âœ… Host: ${HOST}
  âœ… Port: ${PORT}
  âœ… MongoDB: ${mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"}
  âœ… Email Service: ${process.env.RESEND_API_KEY ? "Resend API âœ…" : "Not configured âŒ"}
  âœ… Webhook: http://${HOST}:${PORT}/api/v1/wallet/flutterwave-webhook
  âœ… Health: http://${HOST}:${PORT}/health
  âœ… Debug: http://${HOST}:${PORT}/debug/env
  âœ… Resend Test: http://${HOST}:${PORT}/debug/resend-test
  âœ… Flutterwave Test: http://${HOST}:${PORT}/debug/flutterwave-test
  âœ… Version: 2.0.2
  âœ… Time: ${new Date().toISOString()}
  `);
  
  if (job) {
    console.log("âœ… Cron job initialized");
  }
  
  // Warn about missing Resend API key
  if (!process.env.RESEND_API_KEY) {
    console.warn("âš ï¸  RESEND_API_KEY is not configured. Email sending will fail!");
    console.log("ðŸ’¡ Set up Resend: https://resend.com");
  }
});

/* ----------------------------------------
   GRACEFUL SHUTDOWN
---------------------------------------- */
const shutdown = async (signal) => {
  console.log(`\nâš ï¸  Received ${signal}. Starting graceful shutdown...`);
  
  try {
    server.close(() => {
      console.log("âœ… HTTP server closed");
    });
    
    await mongoose.connection.close();
    console.log("âœ… MongoDB connection closed");
    
    console.log("âœ… Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("âŒ Error during shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ----------------------------------------
   UNHANDLED ERROR HANDLING
---------------------------------------- */
process.on("unhandledRejection", (reason, promise) => {
  console.error("âŒ Unhandled Rejection at:", promise, "reason:", reason);
  if (process.env.NODE_ENV === "production") {
    console.error("Continuing despite unhandled rejection");
  }
});

process.on("uncaughtException", (error) => {
  console.error("âŒ Uncaught Exception:", error);
  if (process.env.NODE_ENV === "production") {
    console.error("Restarting due to uncaught exception");
    process.exit(1);
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default app;

