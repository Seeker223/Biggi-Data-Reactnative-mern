import axios from "axios";
import dotenv from "dotenv";
import Wallet from "../models/walletModel.js";
import User from "../models/userModel.js";

dotenv.config();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// 🧾 Initialize payment
export const initializePayment = async (req, res) => {
  try {
    const { amount, email } = req.body;
    if (!amount || !email) return res.status(400).json({ message: "Amount and email required" });

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { amount: amount * 100, email, currency: "NGN" },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    res.status(200).json({
      success: true,
      authorization_url: response.data.data.authorization_url,
      reference: response.data.data.reference,
    });
  } catch (error) {
    console.error("Paystack init error:", error.message);
    res.status(500).json({ message: "Payment initialization failed" });
  }
};

// ✅ Verify payment
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.query;
    const { userId } = req.user;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const data = response.data.data;

    if (data.status === "success") {
      // Credit user wallet
      const wallet = await Wallet.findOne({ user: userId });
      wallet.main += data.amount / 100;
      await wallet.save();

      res.status(200).json({ success: true, message: "Deposit successful", wallet });
    } else {
      res.status(400).json({ success: false, message: "Verification failed" });
    }
  } catch (error) {
    console.error("Paystack verify error:", error.message);
    res.status(500).json({ message: "Payment verification failed" });
  }
};
