import User from "../models/User.js";

// Top buyers leaderboard
export const getTopBuyersLeaderboard = async (req, res) => {
  try {
    const topUsers = await User.find()
      .sort({ dataBundleCount: -1 }) // highest first
      .limit(50) // show top 50
      .select("username email photo dataBundleCount"); // only important fields

    res.status(200).json({
      success: true,
      leaderboard: topUsers,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
