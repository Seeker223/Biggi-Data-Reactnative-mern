import User from "../models/User.js";

export const getUserGameStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const dailyWins = user.dailyNumberDraw.filter(game => game.isWinner).length;
    const monthlyWins = user.monthlyDraws.filter(draw => draw.isWinner).length;
    
    res.json({
      success: true,
      stats: {
        dailyWins,
        monthlyWins,
        totalWins: dailyWins + monthlyWins,
        totalPrizeWon: user.totalPrizeWon || 0,
        tickets: user.tickets || 0,
        dataPurchases: user.dataBundleCount || 0,
        currentMonthPurchases: user.currentMonthPurchases || 0,
        currentMonthEligible: user.currentMonthEligible || false,
        lastWinDate: user.lastWinDate,
        unclaimedRewards: user.unclaimedRewards,
      }
    });
  } catch (error) {
    console.error("Get user game stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get game statistics",
    });
  }
};

export const getGameAnalytics = async (req, res) => {
  try {
    const { period } = req.params; // daily, weekly, monthly
    
    // Implement analytics logic here
    // For now, return sample data
    res.json({
      success: true,
      period,
      analytics: {
        totalPlayers: 1000,
        activePlayers: 500,
        totalPrizesGiven: 25000,
        dailyDraws: 30,
        monthlyDraws: 1,
        averageWinRate: "15%",
      }
    });
  } catch (error) {
    console.error("Get game analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get game analytics",
    });
  }
};