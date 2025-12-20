// backend/routes/walletRoutes.js
import express from "express";
import { protect } from "../middleware/auth.js";
import { paymentLimiter } from "../middleware/rateLimit.js";

import {
  verifyFlutterwavePayment,
  getDepositStatus,
  reconcilePayment,
} from "../controllers/flutterwaveController.js";

import {
  withdrawFunds,
  getDepositHistory,
  getWithdrawalHistory,
  getUserBalance,
} from "../controllers/walletController.js";

const router = express.Router();

/* ============================================
   🏦 WALLET & PAYMENT ROUTES (PROTECTED)
============================================ */

/* ===============================
   DEPOSIT & PAYMENT MANAGEMENT
================================ */
// Verify Flutterwave payment after SDK completes
router.post(
  "/verify-flutterwave",
  protect,
  paymentLimiter,
  verifyFlutterwavePayment
);

// Poll deposit status for a transaction
router.get("/deposit-status/:tx_ref", protect, getDepositStatus);

// Manual payment reconciliation for stuck payments
router.post(
  "/reconcile-payment",
  protect,
  paymentLimiter,
  reconcilePayment
);

/* ===============================
   WITHDRAWAL MANAGEMENT
================================ */
// Submit withdrawal request
router.post("/withdraw", protect, withdrawFunds);

// Get user's withdrawal history
router.get("/withdraw-history", protect, getWithdrawalHistory);

/* ===============================
   DEPOSIT HISTORY
================================ */
// Get user's deposit history
router.get("/deposit-history", protect, getDepositHistory);

/* ===============================
   BALANCE & WALLET INFO
================================ */
// Get user's current balance
router.get("/balance", protect, getUserBalance);

/* ===============================
   TRANSACTION MANAGEMENT
================================ */
// Get specific deposit details
router.get("/deposit/:id", protect, async (req, res) => {
  try {
    const Deposit = (await import("../models/Deposit.js")).default;
    const deposit = await Deposit.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!deposit) {
      return res.status(404).json({
        success: false,
        message: "Deposit not found",
      });
    }

    res.json({
      success: true,
      deposit,
    });
  } catch (error) {
    console.error("Get deposit error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deposit details",
    });
  }
});

// Cancel pending withdrawal (if possible)
router.patch("/withdraw/:id/cancel", protect, async (req, res) => {
  try {
    const Withdraw = (await import("../models/withdrawModel.js")).default;
    const User = (await import("../models/User.js")).default;
    
    const withdrawal = await Withdraw.findOne({
      _id: req.params.id,
      user: req.user.id,
      status: "pending",
    });

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: "Pending withdrawal not found or cannot be cancelled",
      });
    }

    // Refund amount to user's balance
    const user = await User.findById(req.user.id);
    user.mainBalance += withdrawal.amount;
    await user.save();

    // Update withdrawal status
    withdrawal.status = "cancelled";
    withdrawal.cancelledAt = new Date();
    await withdrawal.save();

    res.json({
      success: true,
      message: "Withdrawal cancelled successfully",
      balance: user.mainBalance,
    });
  } catch (error) {
    console.error("Cancel withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel withdrawal",
    });
  }
});

export default router;