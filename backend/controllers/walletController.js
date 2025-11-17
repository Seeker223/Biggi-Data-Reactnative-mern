// controllers/walletController.js (ESM)

import User from "../models/User.js";
import Withdraw from "../models/withdrawModel.js";

// ==========================================
// 📌 WITHDRAW FUNDS CONTROLLER
// ==========================================
export const withdrawFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { method, bank, accountNumber, accountName, amount } = req.body;

    // Validate fields
    if (!method || !accountNumber || !accountName || !amount) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (Number(amount) < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal is ₦100",
      });
    }

    // Fetch user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Balance check
    const numericAmount = Number(amount);

    if (user.mainBalance < numericAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
      });
    }

    // Deduct user balance
    user.mainBalance -= numericAmount;
    await user.save();

    // Create withdrawal request
    const withdrawRequest = await Withdraw.create({
      user: user._id,
      method,
      bank: method === "Bank Transfer" ? bank : "Opay",
      accountNumber,
      accountName,
      amount: numericAmount,
      status: "pending",
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal submitted successfully",
      balance: user.mainBalance,
      withdraw: withdrawRequest,
    });

  } catch (error) {
    console.error("Withdraw Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error processing withdrawal",
      error: error.message,
    });
  }
};
