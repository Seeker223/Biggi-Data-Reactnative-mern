import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  verifyFlutterwavePayment,
  getDepositStatus,
  flutterwaveWebhook,
} from "../controllers/flutterwaveController.js";

import {
  withdrawFunds,
  getDepositHistory,
} from "../controllers/walletController.js";

const router = express.Router();

/* ===============================
   FLUTTERWAVE (SDK-ONLY FLOW)
================================ */

// Verify payment after Flutterwave SDK completes
router.post(
  "/verify-flutterwave",
  protect,
  paymentLimiter,
  verifyFlutterwavePayment
);

// Poll deposit status
router.get(
  "/deposit-status/:tx_ref",
  protect,
  getDepositStatus
);

// 🚨 WEBHOOK (PUBLIC, RAW BODY, NO AUTH)
router.post(
  "/flutterwave-webhook",
  express.raw({ type: "application/json" }),
  flutterwaveWebhook
);

/* ===============================
   WALLET
================================ */

router.post("/withdraw", protect, withdrawFunds);
router.get("/deposit-history", protect, getDepositHistory);

export default router;
