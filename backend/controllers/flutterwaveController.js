import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/* =========================================
   VERIFY PAYMENT (SDK → BACKEND)
========================================= */
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
      message: "Payment verified. Awaiting webhook.",
      tx_ref: payment.tx_ref,
      amount: payment.amount,
    });
  } catch (error) {
    console.error("Verify Flutterwave Error:", error.response?.data || error);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

/* =========================================
   POLL DEPOSIT STATUS
========================================= */
export const getDepositStatus = async (req, res) => {
  try {
    const { tx_ref } = req.params;

    const deposit = await Deposit.findOne({ reference: tx_ref });

    if (!deposit) {
      return res.json({ status: "pending" });
    }

    return res.json({ status: deposit.status });
  } catch (err) {
    console.error("Deposit status error:", err);
    return res.status(500).json({ status: "failed" });
  }
};

/* =========================================
   WEBHOOK (ONLY CREDITS WALLET)
========================================= */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    if (signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data } = payload;

    if (event !== "charge.completed") {
      return res.status(200).send("Ignored");
    }

    const txRef = data.tx_ref;
    const userId = txRef?.split("_")[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send("Invalid user reference");
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    const existing = await Deposit.findOne({ reference: txRef });
    if (existing) {
      return res.status(200).send("Already processed");
    }

    // FAILED PAYMENT
    if (data.status !== "successful") {
      await Deposit.create({
        user: user._id,
        amount: Number(data.amount || 0),
        reference: txRef,
        status: "failed",
        channel: "flutterwave",
        gatewayResponse: data,
      });

      return res.status(200).send("Payment failed logged");
    }

    // SUCCESSFUL PAYMENT
    await Deposit.create({
      user: user._id,
      amount: Number(data.amount),
      reference: txRef,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: data.id,
      gatewayResponse: data,
    });

    user.mainBalance += Number(data.amount);
    user.totalDeposits += Number(data.amount);
    await user.save();

    await logWalletTransaction(
      user._id,
      "deposit",
      Number(data.amount),
      txRef,
      "success"
    );

    return res.status(200).send("Webhook processed");
  } catch (error) {
    console.error("Flutterwave Webhook Error:", error);
    return res.status(500).send("Webhook processing failed");
  }
};
