// backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (SDK → BACKEND)
   - Confirms payment with Flutterwave
   - DOES NOT credit wallet
===================================================== */
export const verifyFlutterwavePayment = async (req, res) => {
  try {
    const { tx_ref } = req.body;

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
    }

    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const payment = response.data?.data;

    if (!payment || payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    return res.json({
      success: true,
      message: "Payment verified. Awaiting webhook.",
      tx_ref: payment.tx_ref,
      amount: payment.amount,
    });
  } catch (err) {
    console.error("Verify error:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Verification failed" });
  }
};

/* =====================================================
   FLUTTERWAVE WEBHOOK (ONLY PLACE WALLET IS CREDITED)
===================================================== */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];

    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      console.error("❌ Invalid webhook signature");
      return res.sendStatus(401);
    }

    const payload = JSON.parse(req.body.toString());
    const { event, data } = payload;

    // Ignore irrelevant events
    if (event !== "charge.completed") {
      return res.sendStatus(200);
    }

    const { tx_ref, status, amount, id } = data;

    if (!tx_ref || !amount) {
      return res.sendStatus(200);
    }

    // tx_ref format: flw_<USERID>_<timestamp>
    const parts = tx_ref.split("_");
    const userId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error("❌ Invalid user ID in tx_ref:", tx_ref);
      return res.sendStatus(200);
    }

    // Idempotency check
    const alreadyProcessed = await Deposit.findOne({
      reference: tx_ref,
      status: "successful",
    });

    if (alreadyProcessed) {
      return res.sendStatus(200);
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.sendStatus(200);
    }

    // Record failed payment
    if (status !== "successful") {
      await Deposit.create({
        user: user._id,
        amount,
        reference: tx_ref,
        status: "failed",
        channel: "flutterwave",
        flutterwaveTransactionId: id,
        gatewayResponse: data,
      });

      return res.sendStatus(200);
    }

    // ✅ Record successful deposit
    await Deposit.create({
      user: user._id,
      amount,
      reference: tx_ref,
      status: "successful",
      channel: "flutterwave",
      flutterwaveTransactionId: id,
      gatewayResponse: data,
    });

    // ✅ Credit wallet
    user.mainBalance += Number(amount);
    user.totalDeposits += Number(amount);
    await user.save();

    await logWalletTransaction(
      user._id,
      "deposit",
      amount,
      tx_ref,
      "success"
    );

    console.log("✅ Wallet credited:", tx_ref);
    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook crash:", err);
    return res.sendStatus(200); // NEVER FAIL WEBHOOK
  }
};

/* =====================================================
   POLL DEPOSIT STATUS
===================================================== */
export const getDepositStatus = async (req, res) => {
  try {
    const { tx_ref } = req.params;
    const deposit = await Deposit.findOne({ reference: tx_ref });

    if (!deposit) return res.json({ status: "pending" });

    return res.json({ status: deposit.status });
  } catch {
    return res.json({ status: "failed" });
  }
};
