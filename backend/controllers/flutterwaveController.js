//backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/**
 * =====================================================
 * INITIATE FLUTTERWAVE PAYMENT
 * Backend → Flutterwave
 * Returns payment link and tx_ref
 * =====================================================
 */
export const initiateFlutterwavePayment = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount is required and must be greater than 0",
      });
    }

    const tx_ref = `flw_${req.user._id}_${Date.now()}`;

    const paymentData = {
      tx_ref,
      amount,
      currency: "NGN",
      redirect_url: `${process.env.FRONTEND_URL}/deposit/confirmation`,
      customer: {
        email: req.user.email,
        phonenumber: req.user.phoneNumber,
        name: req.user.username,
      },
      payment_options: "card,banktransfer,ussd",
    };

    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    return res.status(200).json({
      success: true,
      data: response.data.data,
      message: "Payment initiated",
      tx_ref,
    });
  } catch (err) {
    console.error("Initiate Flutterwave Error:", err.response?.data || err);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate payment",
    });
  }
};

/**
 * =====================================================
 * VERIFY FLUTTERWAVE PAYMENT (REDIRECT-BASED)
 * Frontend → Backend
 *
 * ⚠️ DOES NOT CREDIT WALLET
 * Wallet crediting happens ONLY in webhook
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
 * GET DEPOSIT STATUS (FOR POLLING)
 * Frontend can poll /wallet/deposit-status/:tx_ref
 * =====================================================
 */
export const getDepositStatus = async (req, res) => {
  try {
    const { tx_ref } = req.params;
    const deposit = await Deposit.findOne({ reference: tx_ref });

    if (!deposit) return res.json({ status: "pending" });

    return res.json({ status: deposit.status }); // success | failed | reversed
  } catch (err) {
    console.error("Deposit status error:", err);
    return res.status(500).json({ status: "failed" });
  }
};

/**
 * =====================================================
 * FLUTTERWAVE WEBHOOK HANDLER
 * Flutterwave → Backend (SERVER TO SERVER)
 * Wallet crediting happens ONLY here
 * =====================================================
 */
export const flutterwaveWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers["verif-hash"];
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
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

    if (alreadyCredited) return res.status(200).send("Already processed");

    // Save deposit
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

    // Log wallet transaction
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
