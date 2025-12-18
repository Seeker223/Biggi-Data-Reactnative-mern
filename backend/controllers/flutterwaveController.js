//backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/**
 * =====================================================
 * VERIFY FLUTTERWAVE PAYMENT (REDIRECT-BASED)
 * Frontend → Backend
 *
 * ⚠️ IMPORTANT:
 * - This endpoint DOES NOT credit wallet
 * - It only confirms payment status for UI feedback
 * - Wallet crediting happens ONLY in webhook
 * =====================================================
 */
export const verifyFlutterwavePayment = async (req, res) => {
  try {
    const { tx_ref } = req.body;

    if (!tx_ref) {
      return res.status(400).json({
        success: false,
        message: "tx_ref is required",
      });
    }

    // 🔎 Verify by reference (recommended)
    const verifyRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const payment = verifyRes.data?.data;

    if (!payment || payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    return res.json({
      success: true,
      message: "Payment verified successfully. Awaiting webhook confirmation.",
      amount: payment.amount,
      currency: payment.currency,
      tx_ref: payment.tx_ref,
    });
  } catch (error) {
    console.error(
      "Verify Flutterwave Error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

/**
 * =====================================================
 * FLUTTERWAVE WEBHOOK HANDLER
 * Flutterwave → Backend (SERVER TO SERVER)
 *
 * ✅ SINGLE SOURCE OF TRUTH
 * ✅ WALLET CREDITING HAPPENS HERE ONLY
 *
 * NOTE:
 * Route must use:
 * express.raw({ type: "application/json" })
 * =====================================================
 */
export const flutterwaveWebhook = async (req, res) => {
  try {
    // 🔐 Verify webhook signature
    const signature = req.headers["verif-hash"];
    if (
      !signature ||
      signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET
    ) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data } = payload;

    if (event !== "charge.completed" || data.status !== "successful") {
      return res.status(200).send("Event ignored");
    }

    const txRef = data.tx_ref;

    /**
     * EXPECTED tx_ref FORMAT:
     * flw_<USER_ID>_<timestamp>
     * Example:
     * flw_65d2a5dfe89cfae9a1234567_1700000000000
     */
    const parts = txRef.split("_");
    const userId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send("Invalid user reference");
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    // 🚫 Prevent double credit
    const alreadyCredited = await Deposit.findOne({
      reference: txRef,
      status: "successful",
    });

    if (alreadyCredited) {
      return res.status(200).send("Already processed");
    }

    // 💾 Save deposit
    await Deposit.create({
      user: user._id,
      amount: Number(data.amount),
      reference: txRef,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: data.id,
      gatewayResponse: data,
    });

    // 💰 Credit wallet
    user.mainBalance += Number(data.amount);
    user.totalDeposits += Number(data.amount);
    await user.save();

    // 🧾 Log wallet transaction
    await logWalletTransaction(
      user._id,
      "deposit",
      Number(data.amount),
      txRef,
      "success"
    );

    return res.status(200).send("Webhook processed successfully");
  } catch (error) {
    console.error("Flutterwave Webhook Error:", error);
    res.status(500).send("Webhook processing failed");
  }
};
