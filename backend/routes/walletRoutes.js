// backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  verifyFlutterwavePayment,
  getDepositStatus,
  flutterwaveWebhook,
  reconcilePayment,
} from "../controllers/flutterwaveController.js";

import {
  withdrawFunds,
  getDepositHistory,
} from "../controllers/walletController.js";

const router = express.Router();

/* ===============================
   FLUTTERWAVE PAYMENT ROUTES
================================ */

// Verify payment after Flutterwave SDK completes (protected)
router.post(
  "/verify-flutterwave",
  protect,
  paymentLimiter,
  verifyFlutterwavePayment
);

// Poll deposit status (protected)
router.get("/deposit-status/:tx_ref", protect, getDepositStatus);

// Manual payment reconciliation (protected)
router.post(
  "/reconcile-payment",
  protect,
  paymentLimiter,
  reconcilePayment
);

/* ===============================
   FLUTTERWAVE WEBHOOK
================================ */

// 🚨 WEBHOOK (PUBLIC, RAW BODY, NO AUTH)
// IMPORTANT: This should only exist in ONE place in your routes
router.post(
  "/flutterwave-webhook",
  express.raw({ type: "application/json" }),
  flutterwaveWebhook
);

/* ===============================
   WALLET MANAGEMENT ROUTES
================================ */

// Withdraw funds
router.post("/withdraw", protect, withdrawFunds);

// Get deposit history
router.get("/deposit-history", protect, getDepositHistory);

export default router;