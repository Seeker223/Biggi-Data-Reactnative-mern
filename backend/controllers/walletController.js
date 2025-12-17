//backend/controllers/walletController.js
import User from "../models/User.js";
import Withdraw from "../models/withdrawModel.js";

export const withdrawFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { method, bank, accountNumber, accountName, amount } = req.body;

    if (!method || !accountNumber || !accountName || !amount) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    if (Number(amount) < 100) {
      return res.status(400).json({ success: false, message: "Minimum withdrawal ₦100" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user.mainBalance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // Deduct wallet
    user.mainBalance -= Number(amount);
    await user.save();

    // Create withdrawal
    const newWithdraw = await Withdraw.create({
      user: userId,
      method,
      bank: method === "Bank Transfer" ? bank : "Opay",
      accountNumber,
      accountName,
      amount,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      message: "Withdrawal submitted (pending admin approval)",
      withdraw: newWithdraw,
      balance: user.mainBalance,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
