import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  initiateFlutterwavePayment,
  verifyFlutterwavePayment,
  getDepositStatus,
  flutterwaveWebhook,
} from "../controllers/flutterwaveController.js";

import { withdrawFunds } from "../controllers/walletController.js";

const router = express.Router();

/**
 * ---------------------------------------------
 * FLUTTERWAVE PAYMENT ENDPOINTS
 * ---------------------------------------------
 */

// Initiate payment → returns tx_ref
router.post("/initiate-flutterwave", protect, paymentLimiter, initiateFlutterwavePayment);

// Verify redirect-based payment (UI confirmation only)
router.post("/verify-flutterwave", protect, paymentLimiter, verifyFlutterwavePayment);

// Poll deposit status
router.get("/deposit-status/:tx_ref", protect, getDepositStatus);

// Webhook (Flutterwave → Backend)
router.post("/flutterwave-webhook", express.raw({ type: "application/json" }), flutterwaveWebhook);

/**
 * ---------------------------------------------
 * WALLET ENDPOINTS
 * ---------------------------------------------
 */

// Withdraw funds
router.post("/withdraw", protect, withdrawFunds);

export default router;
