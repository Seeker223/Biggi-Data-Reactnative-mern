// backend/controllers/monthlyGameController.js
import User from "../models/User.js";
import mongoose from "mongoose";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

const MONTHLY_TOP_WINNERS = 3;
const MONTHLY_MAX_RANKS = 100;
const MONTHLY_WIN_PRIZE = 5000;

const getCurrentMonthString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const getMonthEnd = (month) => {
  const [year, mon] = String(month).split("-").map(Number);
  return new Date(year, mon, 0, 23, 59, 59, 999);
};

const isMonthClosed = (month) => Date.now() > getMonthEnd(month).getTime();

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
    const month = String(req.query.month || getCurrentMonthString());

    const users = await User.find({ "monthlyDraws.month": month })
      .select("username photo monthlyDraws")
      .sort({ username: 1 });

    const ranked = users
      .map((user) => {
        const draw = user.monthlyDraws.find((d) => d.month === month);
        if (!draw || Number(draw.purchasesCount || 0) <= 0) return null;
        return {
          userId: user._id,
          username: user.username,
          photo: user.photo || null,
          purchasesCount: Number(draw.purchasesCount || 0),
          claimed: Boolean(draw.claimed),
          claimedAt: draw.claimedAt || null,
          prizeAmount: Number(draw.prizeAmount || MONTHLY_WIN_PRIZE),
          updatedAt: new Date(draw.updatedAt || draw.lastPurchaseDate || draw.createdAt || Date.now()).getTime(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.purchasesCount !== a.purchasesCount) return b.purchasesCount - a.purchasesCount;
        if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
        return a.username.localeCompare(b.username);
      });

    const rankings = ranked.slice(0, MONTHLY_MAX_RANKS).map((item, idx) => ({
      rank: idx + 1,
      userId: item.userId,
      username: item.username,
      photo: item.photo,
      purchasesCount: item.purchasesCount,
      isWinner: idx < MONTHLY_TOP_WINNERS,
      amount: item.prizeAmount,
      claimed: item.claimed,
      claimedAt: item.claimedAt,
      month,
    }));

    const winnerIdSet = new Set(
      ranked.slice(0, MONTHLY_TOP_WINNERS).map((item) => String(item.userId))
    );
    const monthClosed = isMonthClosed(month);
    const shouldPersistWinners = monthClosed;

    if (shouldPersistWinners) {
      for (const user of users) {
        const draw = user.monthlyDraws.find((d) => d.month === month);
        if (!draw) continue;

        const shouldWin = winnerIdSet.has(String(user._id));
        let changed = false;

        if (Boolean(draw.isWinner) !== shouldWin) {
          draw.isWinner = shouldWin;
          changed = true;
        }
        if (shouldWin && Number(draw.prizeAmount || 0) !== MONTHLY_WIN_PRIZE) {
          draw.prizeAmount = MONTHLY_WIN_PRIZE;
          changed = true;
        }

        if (changed) {
          await user.save();
        }
      }
    }

    const winners = rankings
      .filter((entry) => entry.rank <= MONTHLY_TOP_WINNERS)
      .map((entry) => ({
        ...entry,
        name: entry.username,
      }));

    res.json({
      success: true,
      month,
      monthClosed,
      winners,
      count: winners.length,
      rankings,
      maxRanks: MONTHLY_MAX_RANKS,
      topWinnersCount: MONTHLY_TOP_WINNERS,
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

    if (!isMonthClosed(month)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Monthly rewards can be claimed only after month-end draw.",
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

    const boardUsers = await User.find({ "monthlyDraws.month": month })
      .select("_id monthlyDraws")
      .session(session);

    const winnerIds = boardUsers
      .map((u) => {
        const draw = u.monthlyDraws.find((d) => d.month === month);
        if (!draw || Number(draw.purchasesCount || 0) <= 0) return null;
        return {
          id: String(u._id),
          purchasesCount: Number(draw.purchasesCount || 0),
          updatedAt: new Date(draw.updatedAt || draw.lastPurchaseDate || draw.createdAt || Date.now()).getTime(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.purchasesCount !== a.purchasesCount) return b.purchasesCount - a.purchasesCount;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, MONTHLY_TOP_WINNERS)
      .map((x) => x.id);

    const isTopWinner = winnerIds.includes(String(userId));
    if (!isTopWinner) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Only top 3 buyers can claim monthly rewards.",
      });
    }

    monthlyDraw.isWinner = true;
    monthlyDraw.prizeAmount = Number(monthlyDraw.prizeAmount || MONTHLY_WIN_PRIZE);

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
