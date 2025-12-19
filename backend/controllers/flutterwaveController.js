//backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (CLIENT-INITIATED)
   Frontend → Backend
   DOES NOT CREDIT WALLET (webhook does)
===================================================== */
export const verifyFlutterwavePayment = async (req, res) => {
  try {
    const { tx_ref } = req.body;

    if (!tx_ref) {
      return res.status(400).json({
        success: false,
        message: "tx_ref is required",
      });
    }

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

    return res.status(200).json({
      success: true,
      message: "Payment verified. Awaiting webhook confirmation.",
      amount: payment.amount,
      currency: payment.currency,
      tx_ref: payment.tx_ref,
    });
  } catch (error) {
    console.error(
      "Verify Flutterwave Error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

/* =====================================================
   GET DEPOSIT STATUS (POLLING)
   Frontend polls /wallet/deposit-status/:tx_ref
===================================================== */
export const getDepositStatus = async (req, res) => {
  try {
    const { tx_ref } = req.params;

    const deposit = await Deposit.findOne({ reference: tx_ref });

    if (!deposit) {
      return res.json({ status: "pending" });
    }

    return res.json({ status: deposit.status }); // pending | successful | failed
  } catch (err) {
    console.error("Deposit status error:", err);
    return res.status(500).json({ status: "failed" });
  }
};

/* =====================================================
   GET DEPOSIT HISTORY
   Frontend → /wallet/deposit-history
===================================================== */
export const getDepositHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const deposits = await Deposit.find({ user: userId })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      deposits,
    });
  } catch (err) {
    console.error("Deposit history error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deposit history",
    });
  }
};

/* =====================================================
   FLUTTERWAVE WEBHOOK HANDLER (CRITICAL)
   Flutterwave → Backend (SERVER TO SERVER)
   Wallet crediting happens ONLY here
===================================================== */
export const flutterwaveWebhook = async (req, res) => {
  try {
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
    const parts = txRef.split("_");
    const userId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send("Invalid user reference");
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    // Prevent double credit
    const alreadyCredited = await Deposit.findOne({
      reference: txRef,
      status: "successful",
    });

    if (alreadyCredited) {
      return res.status(200).send("Already processed");
    }

    // Save deposit record
    await Deposit.create({
      user: user._id,
      amount: Number(data.amount),
      reference: txRef,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: data.id,
      gatewayResponse: data,
    });

    // Credit wallet
    user.mainBalance += Number(data.amount);
    user.totalDeposits += Number(data.amount);
    await user.save();

    // Wallet transaction log
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
    return res.status(500).send("Webhook processing failed");
  }
};
