import Withdraw from "../../models/withdrawModel.js";
import User from "../models/User.js";

export const approveWithdrawal = async (req, res) => {
  try {
    const withdrawId = req.params.id;
    const adminId = req.user.id;

    const withdrawal = await Withdraw.findById(withdrawId);
    if (!withdrawal)
      return res.status(404).json({ success: false, message: "Withdrawal not found" });

    if (withdrawal.status !== "pending")
      return res.status(400).json({ success: false, message: "Already processed" });

    withdrawal.status = "approved";
    withdrawal.approvedBy = adminId;
    withdrawal.adminNote = req.body.note || "";
    await withdrawal.save();

    res.status(200).json({ success: true, message: "Withdrawal approved", withdrawal });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const rejectWithdrawal = async (req, res) => {
  try {
    const withdrawId = req.params.id;
    const adminId = req.user.id;

    const withdrawal = await Withdraw.findById(withdrawId);
    if (!withdrawal)
      return res.status(404).json({ success: false, message: "Withdrawal not found" });

    if (withdrawal.status !== "pending")
      return res.status(400).json({ success: false, message: "Already processed" });

    // Refund user
    const user = await User.findById(withdrawal.user);
    user.mainBalance += withdrawal.amount;
    await user.save();

    withdrawal.status = "rejected";
    withdrawal.adminNote = req.body.note || "Rejected by admin";
    withdrawal.approvedBy = adminId;

    await withdrawal.save();

    res.status(200).json({
      success: true,
      message: "Withdrawal rejected & refunded",
      withdrawal,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
