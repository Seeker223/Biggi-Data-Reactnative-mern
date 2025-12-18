//backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  initiateFlutterwavePayment,
  verifyFlutterwavePayment,
  getDepositStatus,
  flutterwaveWebhook,
  getDepositHistory,  // ← import this
} from "../controllers/flutterwaveController.js";

import { withdrawFunds } from "../controllers/walletController.js";

const router = express.Router();

// Payment endpoints
router.post("/initiate-flutterwave", protect, paymentLimiter, initiateFlutterwavePayment);
router.post("/verify-flutterwave", protect, paymentLimiter, verifyFlutterwavePayment);
router.get("/deposit-status/:tx_ref", protect, getDepositStatus);
router.post("/flutterwave-webhook", express.raw({ type: "application/json" }), flutterwaveWebhook);

// Withdraw funds
router.post("/withdraw", protect, withdrawFunds);

// 💰 Deposit history
router.get("/deposit-history", protect, getDepositHistory);

export default router;
