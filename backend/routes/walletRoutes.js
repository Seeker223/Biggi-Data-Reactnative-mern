import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getUserWallet,
  initiateMonnifyPayment,
} from "../controllers/walletController.js";

const router = express.Router();

// Fetch wallet
router.get("/", protect, getUserWallet);

// Initialize Monnify payment (WEBVIEW)
router.post("/initiate-monnify-payment", protect, initiateMonnifyPayment);

export default router;
