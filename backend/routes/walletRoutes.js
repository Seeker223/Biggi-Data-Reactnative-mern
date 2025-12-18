//backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";
import {
  initiateFlutterwavePayment,
  verifyFlutterwavePayment,
  getDepositStatus,
  flutterwaveWebhook,
} from "../controllers/flutterwaveController.js";
import { withdrawFunds, getDepositHistory } from "../controllers/walletController.js";

const router = express.Router();

/* ===========================
   FLUTTERWAVE PAYMENT ENDPOINTS
=========================== */
router.post("/initiate-flutterwave", protect, paymentLimiter, initiateFlutterwavePayment);
router.post("/verify-flutterwave", protect, paymentLimiter, verifyFlutterwavePayment);
router.get("/deposit-status/:tx_ref", protect, getDepositStatus);
router.post("/flutterwave-webhook", express.raw({ type: "application/json" }), flutterwaveWebhook);

/* ===========================
   WALLET ENDPOINTS
=========================== */
router.post("/withdraw", protect, withdrawFunds);

// 🔹 NEW: Deposit history
router.get("/deposit-history", protect, getDepositHistory);

export default router;
