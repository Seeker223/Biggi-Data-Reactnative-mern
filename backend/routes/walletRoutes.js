// backend/routes/walletRoutes.js
import express from "express";
import { verifyFlutterwavePayment, initiateFlutterwavePayment } from "../controllers/flutterwaveController.js";
import { withdrawFunds } from "../controllers/walletController.js";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// Initiate Flutterwave payment (rate-limited)
router.post("/initiate-flutterwave", protect, paymentLimiter, initiateFlutterwavePayment);

// Verify Flutterwave payment (UI confirmation only, rate-limited)
router.post("/verify-flutterwave", protect, paymentLimiter, verifyFlutterwavePayment);

// Withdraw funds from wallet
router.post("/withdraw", protect, withdrawFunds);

export default router;
