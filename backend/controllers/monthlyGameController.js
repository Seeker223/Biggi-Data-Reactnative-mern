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

    const currentMonth = user.getCurrentMonthString
      ? user.getCurrentMonthString()
      : getCurrentMonthString();

    const monthlyDraw = (user.monthlyDraws || []).find(
      (d) => d.month === currentMonth
    ) || { purchasesCount: 0 };

    const purchases = Number(monthlyDraw.purchasesCount || 0);

    const ticketsThisMonth = (user.monthlyRaffleTickets || []).filter(
      (t) => t.month === currentMonth
    );
    const unplayed = ticketsThisMonth.filter((t) => !t.played);
    const played = ticketsThisMonth.filter((t) => t.played);

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysLeft = Math.max(0, lastDay.getDate() - now.getDate());

    return res.json({
      success: true,
      eligibility: {
        month: currentMonth,
        purchases,
        required: 5,
        progress: Math.min(100, (purchases / 5) * 100),
        requiredPurchasesPerTicket: 5,
        raffleTicketsTotal: ticketsThisMonth.length,
        raffleTicketsUnplayed: unplayed.length,
        raffleTicketsPlayed: played.length,
        isEligible: ticketsThisMonth.length > 0,
        prizeAmount: MONTHLY_WIN_PRIZE,
        daysLeft,
        drawDate: lastDay.toISOString(),
      },
    });
  } catch (error) {
    console.error("Get monthly eligibility error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get monthly eligibility",
    });
  }
};

/* =====================================================
   GET USER MONTHLY RAFFLE TICKETS
===================================================== */
export const getMonthlyRaffleTickets = async (req, res) => {
  try {
    const month = normalizeMonth(req.query.month);

    const user = await User.findById(req.user.id).select(
      "username monthlyRaffleTickets"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const tickets = (user.monthlyRaffleTickets || [])
      .filter((t) => t.month === month)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
      .map((t) => ({
        id: String(t._id),
        month: t.month,
        code: t.code,
        issuedAt: t.issuedAt,
        played: Boolean(t.played),
        playedAt: t.playedAt || null,
      }));

    return res.json({
      success: true,
      month,
      tickets,
      count: tickets.length,
    });
  } catch (error) {
    console.error("Get monthly raffle tickets error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get raffle tickets",
    });
  }
};

/* =====================================================
   PLAY MONTHLY RAFFLE TICKET (creates a pending entry)
===================================================== */
export const playMonthlyRaffleTicket = async (req, res) => {
  try {
    const month = normalizeMonth(req.body?.month || req.query?.month);
    const codeInput = String(req.body?.code || "").trim();
    const ticketId = String(req.body?.ticketId || "").trim();

    if (!codeInput && !ticketId) {
      return res.status(400).json({
        success: false,
        message: "Ticket code is required",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketsThisMonth = (user.monthlyRaffleTickets || []).filter(
      (t) => t.month === month
    );

    const ticket = ticketId
      ? ticketsThisMonth.find((t) => String(t._id) === String(ticketId))
      : ticketsThisMonth.find((t) => String(t.code) === codeInput);

    if (!ticket) {
      return res.status(400).json({
        success: false,
        message: "Invalid raffle ticket",
      });
    }

    if (ticket.played) {
      return res.status(400).json({
        success: false,
        message: "This raffle ticket has already been played",
      });
    }

    const playedAt = new Date();

    try {
      const entry = await MonthlyRaffleEntry.create({
        month,
        code: ticket.code,
        user: user._id,
        status: "pending",
        playedAt,
      });

      ticket.played = true;
      ticket.playedAt = playedAt;

    user.addNotification({
      type: "Monthly Draw",
      status: "info",
      message: `Ticket ${ticket.code} entered for Monthly Draw (${month}). Status: Pending until month end.`,
    });

    await user.save();

    await sendUserEmail({
      userId: user._id,
      type: "monthly_entry",
      email: user.email,
      subject: "Monthly Draw Entry Submitted",
      title: "Monthly Draw Entry Submitted",
      bodyLines: [
        `Your ticket ${ticket.code} has been entered for the monthly draw (${month}).`,
        "Status: Pending until month end.",
      ],
    });

      return res.json({
        success: true,
        message: "Ticket played successfully",
        month,
        entry: {
          id: String(entry._id),
          code: entry.code,
          playedAt: entry.playedAt,
        },
      });
    } catch (err) {
      if (Number(err?.code) === 11000) {
        return res.status(400).json({
          success: false,
          message: "This raffle ticket code has already been used",
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("Play monthly raffle ticket error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to play raffle ticket",
    });
  }
};

/* =====================================================
   GET MONTHLY WINNERS / ENTRIES
===================================================== */
export const getMonthlyWinners = async (req, res) => {
  try {
    const month = normalizeMonth(req.query.month);

    if (isMonthClosed(month)) {
      // Ensure the draw exists once month ends.
      await runMonthlyRaffleDrawIfDue(month);
    }

    const draw = await MonthlyRaffleDraw.findOne({ month }).lean();

    const entries = await MonthlyRaffleEntry.find({ month })
      .populate("user", "username photo")
      .sort({ playedAt: -1 })
      .limit(500)
      .lean();

    const list = entries.map((entry, idx) => {
      const isWinner = draw && String(draw.entry) === String(entry._id);
      return {
        rank: idx + 1,
        entryId: entry._id,
        userId: entry.user?._id || entry.user,
        username: entry.user?.username || "Player",
        photo: entry.user?.photo || null,
        code: String(entry.code || ""),
        codeMasked: maskCode(entry.code),
        status: isWinner ? "winner" : "pending",
        playedAt: entry.playedAt || entry.createdAt || null,
        month,
      };
    });

    return res.json({
      success: true,
      month,
      monthClosed: isMonthClosed(month),
      entries: list,
      winner: draw
        ? {
            month: draw.month,
            winningCode: draw.winningCode,
            winnerUser: draw.winnerUser,
            drawnAt: draw.drawnAt,
            claimed: Boolean(draw.claimed),
            claimedAt: draw.claimedAt || null,
            prizeAmount: MONTHLY_WIN_PRIZE,
          }
        : null,
      count: list.length,
    });
  } catch (error) {
    console.error("Get monthly winners error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get monthly winners",
    });
  }
};

/* =====================================================
   CLAIM MONTHLY REWARD (winner only)
===================================================== */
export const claimMonthlyReward = async (req, res) => {
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Monthly rewards are temporarily disabled for review.",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const month = normalizeMonth(req.body?.month);
    const userId = req.user.id;

    if (!isMonthClosed(month)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Monthly rewards can be claimed only after month-end draw.",
      });
    }

    await runMonthlyRaffleDrawIfDue(month, { session });

    const draw = await MonthlyRaffleDraw.findOne({ month }).session(session);
    if (!draw) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No monthly draw result found for this month.",
      });
    }

    if (String(draw.winnerUser) !== String(userId)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Only the selected raffle ticket owner can claim this monthly reward.",
      });
    }

    if (draw.claimed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
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

    draw.claimed = true;
    draw.claimedAt = new Date();

    user.rewardBalance = Number(user.rewardBalance || 0) + MONTHLY_WIN_PRIZE;
    user.totalPrizeWon = Number(user.totalPrizeWon || 0) + MONTHLY_WIN_PRIZE;
    user.totalWins = Number(user.totalWins || 0) + 1;

    user.addNotification({
      type: "Monthly Draw",
      status: "success",
      amount: MONTHLY_WIN_PRIZE,
      message: `Monthly draw reward claimed for ${month}: N${MONTHLY_WIN_PRIZE.toLocaleString()} added to reward balance.`,
    });

    await user.save({ session });
    await draw.save({ session });

    await session.commitTransaction();

    await awardReferralReward({
      winner: user,
      prizeAmount: MONTHLY_WIN_PRIZE,
      gameLabel: "Monthly Draw",
    });

    await sendUserEmail({
      userId: userId,
      type: "monthly_claim",
      email: user.email,
      subject: "Monthly Draw Reward Claimed",
      title: "Reward Claimed",
      bodyLines: [
        `You claimed N${MONTHLY_WIN_PRIZE.toLocaleString()} for the monthly draw (${month}).`,
        "Your reward balance has been updated.",
      ],
    });

    return res.json({
      success: true,
      message: "Monthly reward claimed successfully",
      reward: {
        month,
        amount: MONTHLY_WIN_PRIZE,
        claimedAt: draw.claimedAt,
        winningCode: draw.winningCode,
      },
      balance: user.rewardBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Claim monthly reward error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to claim monthly reward",
    });
  } finally {
    session.endSession();
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
  getPreviousMonthString,
};

