import axios from "axios";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";

export const verifyFlutterwavePayment = async (req, res) => {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required",
      });
    }

    // 🔐 Verify payment with Flutterwave
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
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

    // Prevent duplicate credit
    const existingTx = await Transaction.findOne({
      reference: payment.tx_ref,
    });

    if (existingTx) {
      return res.json({
        success: true,
        message: "Payment already processed",
      });
    }

    // Get wallet
    const wallet = await Wallet.findOne({ user: req.user.id });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    // Credit wallet
    wallet.balance += Number(payment.amount);
    await wallet.save();

    // Save transaction
    await Transaction.create({
      user: req.user.id,
      amount: payment.amount,
      type: "credit",
      status: "successful",
      reference: payment.tx_ref,
      provider: "flutterwave",
    });

    return res.json({
      success: true,
      message: "Wallet credited successfully",
      balance: wallet.balance,
    });
  } catch (error) {
    console.error("Flutterwave verification error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};
