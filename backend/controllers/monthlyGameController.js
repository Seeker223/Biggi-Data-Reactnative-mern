// backend/controllers/monthlyGameController.js
import User from "../models/User.js";
import mongoose from "mongoose";
import { FEATURE_FLAGS } from "../config/featureFlags.js";
import MonthlyRaffleEntry from "../models/MonthlyRaffleEntry.js";
import MonthlyRaffleDraw from "../models/MonthlyRaffleDraw.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const MONTHLY_WIN_PRIZE = 10000;

const getCurrentMonthString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const normalizeMonth = (raw) => {
  const input = String(raw || "").trim();
  if (/^\d{4}-\d{2}$/.test(input)) return input;
  return getCurrentMonthString();
};

const getMonthEnd = (month) => {
  const [year, mon] = String(month).split("-").map(Number);
  return new Date(year, mon, 0, 23, 59, 59, 999);
};

const isMonthClosed = (month) => Date.now() > getMonthEnd(month).getTime();

const getPreviousMonthString = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const maskCode = (code) => {
  const value = String(code || "");
  if (value.length <= 2) return value;
  return `${value.slice(0, 2)}****`;
};

const awardReferralReward = async ({ winner, prizeAmount, gameLabel }) => {
  const referralCode = winner?.referredByCode;
  if (!referralCode) return null;

  const referrer = await User.findOne({ referralCode }).select(
    "_id username rewardBalance totalPrizeWon referralRewardedUsers notificationItems notifications"
  );
  if (!referrer) return null;
  if (String(referrer._id) === String(winner._id)) return null;

  const alreadyRewarded = (referrer.referralRewardedUsers || []).some(
    (id) => String(id) === String(winner._id)
  );
  if (alreadyRewarded) return null;

  const bonus = Math.floor(Number(prizeAmount || 0) * 0.2);
  if (bonus <= 0) return null;

  referrer.rewardBalance = Number(referrer.rewardBalance || 0) + bonus;
  referrer.totalPrizeWon = Number(referrer.totalPrizeWon || 0) + bonus;
  referrer.referralRewardedUsers = [
    ...(referrer.referralRewardedUsers || []),
    winner._id,
  ];
  referrer.addNotification({
    type: "Referral Reward",
    status: "success",
    amount: bonus,
    message: `${winner.username || "Your referral"} won ${gameLabel}. You earned N${bonus.toLocaleString()}.`,
  });

  await referrer.save();
  return bonus;
};

export const runMonthlyRaffleDrawIfDue = async (rawMonth, options = {}) => {
  const month = normalizeMonth(rawMonth);
  const session = options.session || null;

  if (!isMonthClosed(month)) {
    return { success: true, month, status: "not_due", draw: null };
  }

  const existing = await MonthlyRaffleDraw.findOne({ month }).session(session);
  if (existing) {
    return { success: true, month, status: "already_drawn", draw: existing };
  }

  const pipeline = [{ $match: { month } }, { $sample: { size: 1 } }];
  const picked = await MonthlyRaffleEntry.aggregate(pipeline).session(session);
  const entry = picked?.[0] || null;
  if (!entry) {
    return { success: true, month, status: "no_entries", draw: null };
  }

  const now = new Date();

  try {
    const created = await MonthlyRaffleDraw.create(
      [
        {
          month,
          winningCode: entry.code,
          winnerUser: entry.user,
          entry: entry._id,
          drawnAt: now,
          claimed: false,
          claimedAt: null,
        },
      ],
      { session }
    );

    await MonthlyRaffleEntry.updateOne(
      { _id: entry._id },
      { $set: { status: "winner" } }
    ).session(session);

    const winner = await User.findById(entry.user).session(session);
    if (winner) {
      winner.addNotification({
        type: "Monthly Draw Result",
        status: "success",
        amount: MONTHLY_WIN_PRIZE,
        message: `Monthly draw result for ${month}: your ticket ${entry.code} won. You can claim your reward now.`,
      });
      await winner.save({ session });
    }

    try {
      const allEntries = await MonthlyRaffleEntry.find({ month }).select("user code").lean();
      const winnerId = String(entry.user);
      const uniqueUsers = new Map();
      for (const e of allEntries) {
        const uid = String(e.user);
        if (!uniqueUsers.has(uid)) uniqueUsers.set(uid, e.code);
      }

      for (const [uid, code] of uniqueUsers.entries()) {
        const user = await User.findById(uid).select("email username");
        if (!user) continue;
        const isWinner = uid === winnerId;
        await sendUserEmail({
          userId: user._id,
          type: "monthly_result",
          email: user.email,
          subject: "Monthly Draw Result",
          title: "Monthly Draw Result",
          bodyLines: [
            isWinner
              ? `Congratulations! Your ticket ${code} won the monthly draw.`
              : `Monthly draw completed for ${month}. Your ticket ${code} was not selected this time.`,
            "You can view details in your Biggi Data account.",
          ],
        });
      }
    } catch (mailErr) {
      console.error("Monthly draw email error:", mailErr?.message || mailErr);
    }

    return {
      success: true,
      month,
      status: "drawn",
      draw: created?.[0] || null,
    };
  } catch (err) {
    // Handle race: another worker created the draw.
    if (Number(err?.code) === 11000) {
      const draw = await MonthlyRaffleDraw.findOne({ month }).session(session);
      return { success: true, month, status: "already_drawn", draw };
    }
    throw err;
  }
};

/* =====================================================
   TOP PURCHASES LEADERBOARD (MONTHLY)
===================================================== */
export const getTopPurchasersLeaderboard = async (req, res) => {
  try {
    const month = normalizeMonth(req.query?.month);
    const threshold = 10;

    const rows = await User.aggregate([
      { $unwind: "$monthlyDraws" },
      {
        $match: {
          "monthlyDraws.month": month,
          "monthlyDraws.purchasesCount": { $gte: threshold },
        },
      },
      {
        $project: {
          _id: 1,
          username: 1,
          photo: 1,
          state: 1,
          purchasesCount: "$monthlyDraws.purchasesCount",
          lastPurchaseDate: "$monthlyDraws.lastPurchaseDate",
        },
      },
      { $sort: { purchasesCount: -1, lastPurchaseDate: 1, _id: 1 } },
      { $limit: 10 },
    ]);

    const leaderboard = rows.map((row, index) => ({
      rank: index + 1,
      userId: row._id,
      username: row.username,
      photo: row.photo,
      state: row.state,
      purchasesCount: row.purchasesCount,
    }));

    const user = await User.findById(req.user.id).select("monthlyDraws");
    const mine = (user?.monthlyDraws || []).find((d) => d.month === month);
    const myPurchases = Number(mine?.purchasesCount || 0);

    return res.json({
      success: true,
      month,
      threshold,
      leaderboard,
      myPurchases,
      qualified: myPurchases >= threshold,
    });
  } catch (error) {
    console.error("Top purchases leaderboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load top purchases leaderboard",
    });
  }
};

/* =====================================================
   UPDATE MONTHLY PURCHASE COUNT
   Disabled: purchases and raffle tickets are updated automatically on real buy-data success.
===================================================== */
export const updateMonthlyPurchase = async (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Monthly purchases are updated automatically after successful data purchases.",
  });
};
export { getPreviousMonthString };

export default {
  getMonthlyEligibility,
  getMonthlyWinners,
  claimMonthlyReward,
  updateMonthlyPurchase,
  getMonthlyRaffleTickets,
  playMonthlyRaffleTicket,
  runMonthlyRaffleDrawIfDue,
  getTopPurchasersLeaderboard,
  getPreviousMonthString,
};







