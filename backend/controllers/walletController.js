// controllers/walletController.js
import Wallet from "../models/Wallet.js";
import User from "../models/User.js";

export const getUserWallet = async (req, res) => {
  try {
    // In production, you’d use req.user.id (after auth middleware)
    const userId = req.query.userId || "672f2b871b0f29160bce2a10"; // demo fallback ID

    const user = await User.findById(userId).select("username photo email");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const wallet = await Wallet.findOne({ userId });
    if (!wallet)
      return res.status(404).json({ success: false, error: "Wallet not found" });

    res.status(200).json({
      success: true,
      user,
      wallet,
    });
  } catch (err) {
    console.error("Wallet fetch error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
