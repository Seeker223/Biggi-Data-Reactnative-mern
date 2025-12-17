// backend/controllers/flutterwaveController.js
import axios from "axios";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/**
 * VERIFY FLUTTERWAVE PAYMENT (Redirect-based)
 * Frontend → Backend
 */
export const verifyFlutterwavePayment = async (req, res) => {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID required",
      });
    }

    // 🔎 Verify with Flutterwave
    const verifyRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const payment = verifyRes.data.data;

    if (payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    const txRef = payment.tx_ref;
    const userId = txRef.split("_")[0];

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🚫 Prevent duplicate credit
    const alreadyCredited = await Deposit.findOne({
      reference: txRef,
      status: "successful",
    });

    if (alreadyCredited) {
      return res.json({
        success: true,
        message: "Payment already processed",
      });
    }

    // 💾 Save deposit
    await Deposit.create({
      user: user._id,
      amount: Number(payment.amount),
      reference: txRef,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: payment.id,
      gatewayResponse: verifyRes.data,
    });

    // 💰 Credit wallet
    user.mainBalance += Number(payment.amount);
    user.totalDeposits += Number(payment.amount);
    await user.save();

    // 🧾 Log transaction
    await logWalletTransaction(
      user._id,
      "deposit",
      Number(payment.amount),
      txRef,
      "success"
    );

    return res.json({
      success: true,
      message: "Wallet funded successfully",
      balance: user.mainBalance,
    });
  } catch (error) {
    console.error(
      "Verify Flutterwave Error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
};

/**
 * FLUTTERWAVE WEBHOOK HANDLER
 * Flutterwave → Backend (Server-to-server)
 * Must use express.raw({ type: "application/json" }) in route
 */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("Flutterwave Webhook Received:", payload);

    const event = payload.event;
    const data = payload.data;

    if (event === "charge.completed" && data.status === "successful") {
      const txRef = data.tx_ref;
      const userId = txRef.split("_")[0];

      const user = await User.findById(userId);
      if (!user) return res.status(404).send("User not found");

      // 🚫 Prevent duplicate credit
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
        gatewayResponse: payload,
      });

      // 💰 Credit wallet
      user.mainBalance += Number(data.amount);
      user.totalDeposits += Number(data.amount);
      await user.save();

      // 🧾 Log transaction
      await logWalletTransaction(
        user._id,
        "deposit",
        Number(data.amount),
        txRef,
        "success"
      );

      return res.status(200).send("Webhook processed successfully");
    }

    return res.status(200).send("Event ignored");
  } catch (error) {
    console.error("Flutterwave Webhook Error:", error);
    return res.status(500).send("Webhook processing failed");
  }
};
