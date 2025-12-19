// backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (SDK → BACKEND)
   - Called from React Native after SDK completes
   - DOES NOT credit wallet
   - Webhook is the single source of truth
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
      tx_ref: payment.tx_ref,
      amount: payment.amount,
      currency: payment.currency,
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
   POLL DEPOSIT STATUS
   Frontend → /wallet/deposit-status/:tx_ref
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
   FLUTTERWAVE WEBHOOK (CRITICAL)
   - ONLY place wallet is credited
   - Must be PUBLIC
   - Must use express.raw()
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

    // Only care about completed charges
    if (event !== "charge.completed") {
      return res.status(200).send("Event ignored");
    }

    const txRef = data.tx_ref;
    const amount = Number(data.amount || 0);

    if (!txRef) {
      return res.status(400).send("Missing tx_ref");
    }

    // tx_ref format: flw_<USER_ID>_<timestamp>
    const parts = txRef.split("_");
    const userId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send("Invalid user reference");
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send("User not found");
    }

    // Prevent double credit (idempotency)
    const alreadyProcessed = await Deposit.findOne({
      reference: txRef,
      status: "successful",
    });

    if (alreadyProcessed) {
      return res.status(200).send("Already processed");
    }

    // Handle failed payment
    if (data.status !== "successful") {
      await Deposit.create({
        user: user._id,
        amount,
        reference: txRef,
        status: "failed",
        channel: "flutterwave",
        flutterwaveTransactionId: data.id,
        gatewayResponse: data,
      });

      return res.status(200).send("Failed payment recorded");
    }

    // Record successful deposit
    await Deposit.create({
      user: user._id,
      amount,
      reference: txRef,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: data.id,
      gatewayResponse: data,
    });

    // Credit wallet
    user.mainBalance += amount;
    user.totalDeposits += amount;
    await user.save();

    // Wallet transaction log
    await logWalletTransaction(
      user._id,
      "deposit",
      amount,
      txRef,
      "success"
    );

    return res.status(200).send("Webhook processed successfully");
  } catch (error) {
    console.error("Flutterwave Webhook Error:", error);
    return res.status(500).send("Webhook processing failed");
  }
};
