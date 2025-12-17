// backend/routes/walletRoutes.js
import express from "express";
import { verifyFlutterwavePayment } from "../controllers/flutterwaveController.js";
import { withdrawFunds } from "../controllers/walletController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Flutterwave redirect verification
router.post("/verify-flutterwave", protect, verifyFlutterwavePayment);

// Withdraw
router.post("/withdraw", protect, withdrawFunds);

export default router;

