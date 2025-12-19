//backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  verifyFlutterwavePayment,
  getDepositStatus,
} from "../controllers/flutterwaveController.js";

import {
  withdrawFunds,
  getDepositHistory,
} from "../controllers/walletController.js";

const router = express.Router();

/* =====================================================
   FLUTTERWAVE PAYMENT (CLIENT INITIATED)
   React Native SDK → Backend verification
===================================================== */

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

/* =====================================================
   WALLET OPERATIONS
===================================================== */

// Withdraw funds
router.post(
  "/withdraw",
  protect,
  withdrawFunds
);

// Deposit history
router.get(
  "/deposit-history",
  protect,
  getDepositHistory
);

export default router;
