// backend/routes/walletRoutes.js
import express from "express";
import { verifyFlutterwavePayment } from "../controllers/flutterwaveController.js";
import { withdrawFunds } from "../controllers/walletController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/v1/wallet/verify-flutterwave
 * Verifies a Flutterwave transaction (Redirect-based)
 * - Works with live ObjectId users
 * - Works with test transactions using `testRef`
 */
router.post("/verify-flutterwave", protect, verifyFlutterwavePayment);

// Withdraw funds from wallet
router.post("/withdraw", protect, withdrawFunds);

export default router;
