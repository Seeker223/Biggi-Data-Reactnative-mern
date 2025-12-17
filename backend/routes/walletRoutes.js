// backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { withdrawFunds } from "../controllers/walletController.js";
import { verifyFlutterwavePayment } from "../controllers/flutterwaveController.js";

const router = express.Router();

// ✅ Verify Flutterwave payment & credit wallet
router.post("/verify-flutterwave", protect, verifyFlutterwavePayment);

// Withdraw
router.post("/withdraw", protect, withdrawFunds);

export default router;
