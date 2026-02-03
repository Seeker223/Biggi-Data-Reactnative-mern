// backend/controllers/monthlyGameController.js
import User from "../models/User.js";
import mongoose from "mongoose";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

/* =====================================================
   GET MONTHLY ELIGIBILITY
===================================================== */
export const getMonthlyEligibility = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentMonth = user.getCurrentMonthString();
    const monthlyDraw = user.monthlyDraws.find(d => d.month === currentMonth) || {
      month: currentMonth,
      purchasesCount: 0,
      isEligible: false,
      isWinner: false,
      prizeAmount: 5000,
      claimed: false
    };

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysLeft = Math.max(0, lastDay.getDate() - now.getDate());

    res.json({
      success: true,
      eligibility: {
        purchases: monthlyDraw.purchasesCount,
        required: 5,
        progress: Math.min(100, (monthlyDraw.purchasesCount / 5) * 100),
        isEligible: monthlyDraw.purchasesCount >= 5,
        isWinner: monthlyDraw.isWinner,
        prizeAmount: monthlyDraw.prizeAmount,
        claimed: monthlyDraw.claimed,
        month: currentMonth,
        daysLeft,
        drawDate: lastDay.toISOString(),
      },
    });
  } catch (error) {
    console.error("Get monthly eligibility error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get monthly eligibility",
    });
  }
};

/* =====================================================
   GET MONTHLY WINNERS
===================================================== */
export const getMonthlyWinners = async (req, res) => {
  try {
    const { month } = req.query;
    
    let query = {};
    if (month) {
      query = { "monthlyDraws.month": month, "monthlyDraws.isWinner": true };
    } else {
      query = { "monthlyDraws.isWinner": true };
    }

    const winners = await User.find(query)
      .select("username email monthlyDraws")
      .lean();

    const formattedWinners = winners.flatMap(user => 
      user.monthlyDraws
        .filter(draw => draw.isWinner)
        .map(draw => ({
          name: user.username,
          userId: user._id,
          month: draw.month,
          amount: draw.prizeAmount,
          claimed: draw.claimed,
          claimedAt: draw.claimedAt,
        }))
    );

    // Sort by month descending
    formattedWinners.sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      success: true,
      winners: formattedWinners,
      count: formattedWinners.length,
    });
  } catch (error) {
    console.error("Get monthly winners error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get monthly winners",
    });
  }
};

/* =====================================================
   CLAIM MONTHLY REWARD
===================================================== */
export const claimMonthlyReward = async (req, res) => {
  // 🚩 Feature flag: Disable claiming rewards during Play Store review
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Monthly rewards are temporarily disabled for review.",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { month } = req.body;
    const userId = req.user.id;

    if (!month) {
      return res.status(400).json({
        success: false,
        message: "Month is required",
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const monthlyDraw = user.monthlyDraws.find(d => d.month === month);
    if (!monthlyDraw) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Monthly draw record not found",
      });
    }

    if (!monthlyDraw.isWinner) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "You are not a winner for this month",
      });
    }

    if (monthlyDraw.claimed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
      });
    }

    // Claim the reward
    monthlyDraw.claimed = true;
    monthlyDraw.claimedAt = new Date();
    user.rewardBalance += monthlyDraw.prizeAmount;
    user.totalPrizeWon += monthlyDraw.prizeAmount;
    user.totalWins += 1;

    await user.save({ session });
    await session.commitTransaction();

    res.json({
      success: true,
      message: "Monthly reward claimed successfully",
      reward: {
        month: monthlyDraw.month,
        amount: monthlyDraw.prizeAmount,
        claimedAt: monthlyDraw.claimedAt,
      },
      balance: user.rewardBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Claim monthly reward error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to claim monthly reward",
    });
  } finally {
    session.endSession();
  }
};

/* =====================================================
   UPDATE MONTHLY PURCHASE COUNT
===================================================== */
export const updateMonthlyPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await user.updateMonthlyPurchase();

    res.json({
      success: true,
      message: "Monthly purchase updated",
      monthlyProgress: {
        purchases: user.currentMonthPurchases,
        required: 5,
        isEligible: user.currentMonthEligible,
        progress: Math.min(100, (user.currentMonthPurchases / 5) * 100),
      },
    });
  } catch (error) {
    console.error("Update monthly purchase error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update monthly purchase",
    });
  }
};

export default {
  getMonthlyEligibility,
  getMonthlyWinners,
  claimMonthlyReward,
  updateMonthlyPurchase,
};