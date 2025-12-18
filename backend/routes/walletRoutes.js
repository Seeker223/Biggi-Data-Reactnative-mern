import express from "express";
import { verifyFlutterwavePayment } from "../controllers/flutterwaveController.js";
import { withdrawFunds } from "../controllers/walletController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/v1/wallet/verify-flutterwave
 * Redirect-based verification (UI confirmation only)
 * ⚠️ Does NOT credit wallet
 * Wallet crediting happens ONLY via webhook
 */
router.post("/verify-flutterwave", protect, verifyFlutterwavePayment);

// Withdraw funds from wallet
router.post("/withdraw", protect, withdrawFunds);

export default router;
