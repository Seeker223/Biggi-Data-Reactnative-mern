// backend/controllers/monthlyGameController.js
import User from "../models/User.js";
import mongoose from "mongoose";
import { FEATURE_FLAGS } from "../config/featureFlags.js";
import MonthlyRaffleEntry from "../models/MonthlyRaffleEntry.js";
import MonthlyRaffleDraw from "../models/MonthlyRaffleDraw.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const MONTHLY_WIN_PRIZE = 10000;
const MONTHLY_CARD_SET_COUNT = 5;
const MONTHLY_CARD_SET_LENGTH = 3;
const CARD_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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

const normalizeCardCode = (raw) =>
  String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, MONTHLY_CARD_SET_LENGTH);

const lettersToCode = (letters = []) => normalizeCardCode(Array.isArray(letters) ? letters.join("") : letters);

const codesMatch = (left = "", right = "") => normalizeCardCode(left) === normalizeCardCode(right);

const buildWinningSets = (month) => {
  let seed = 0;
  for (let i = 0; i < month.length; i += 1) {
    seed = (seed * 31 + month.charCodeAt(i)) >>> 0;
  }
  const nextIndex = (max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  const bag = [...CARD_LETTERS];
  const sets = [];
  while (sets.length < MONTHLY_CARD_SET_COUNT && bag.length >= MONTHLY_CARD_SET_LENGTH) {
    const picked = [];
    for (let i = 0; i < MONTHLY_CARD_SET_LENGTH; i += 1) {
      const idx = nextIndex(bag.length);
      picked.push(bag.splice(idx, 1)[0]);
    }
    sets.push(picked);
  }
  return sets;
};

const getMonthlyCardSlots = async (month, userId) => {
  const entries = await MonthlyRaffleEntry.find({ month, user: userId })
    .sort({ setIndex: 1, createdAt: 1 })
    .lean();

  const played = new Map(entries.map((entry) => [Number(entry.setIndex), entry]));
  return Array.from({ length: MONTHLY_CARD_SET_COUNT }, (_, index) => {
    const setIndex = index + 1;
    const entry = played.get(setIndex) || null;
    return {
      id: entry?._id || `set-${setIndex}`,
      setIndex,
      code: entry?.code || "",
      month,
      played: Boolean(entry),
      locked: false,
      issuedAt: entry?.createdAt || null,
      playedAt: entry?.playedAt || null,
      status: entry?.status || "pending",
    };
  });
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
  if (existing?.winningSets?.length === MONTHLY_CARD_SET_COUNT) {
    return { success: true, month, status: "already_drawn", draw: existing };
  }

  const winningSets = existing?.winningSets?.length === MONTHLY_CARD_SET_COUNT
    ? existing.winningSets
    : buildWinningSets(month);

  const now = new Date();

  try {
    let drawDoc = existing;
    if (drawDoc) {
      drawDoc.winningSets = winningSets;
      drawDoc.drawnAt = drawDoc.drawnAt || now;
      drawDoc.claimed = Boolean(drawDoc.claimed);
      drawDoc.claimedAt = drawDoc.claimedAt || null;
      drawDoc.winnerUserIds = drawDoc.winnerUserIds || [];
      await drawDoc.save({ session });
    } else {
      const created = await MonthlyRaffleDraw.create(
        [
          {
            month,
            winningSets,
            drawnAt: now,
            claimed: false,
            claimedAt: null,
            winnerUserIds: [],
          },
        ],
        { session }
      );
      drawDoc = created?.[0] || null;
    }

    const entries = await MonthlyRaffleEntry.find({ month }).session(session);
    const winnersByUser = new Map();

    for (const entry of entries) {
      const isWinner = winningSets.some((set) => codesMatch(lettersToCode(set), entry.code));
      entry.status = isWinner ? "winner" : "pending";
      if (isWinner) {
        winnersByUser.set(String(entry.user), true);
      }
      await entry.save({ session });
    }

    const winnerIds = [...winnersByUser.keys()];
    drawDoc.winnerUserIds = winnerIds;
    await drawDoc.save({ session });

    for (const winnerId of winnerIds) {
      const winner = await User.findById(winnerId).session(session);
      if (!winner) continue;
      const monthDraw = (winner.monthlyDraws || []).find((d) => d.month === month);
      if (monthDraw) {
        monthDraw.isWinner = true;
        monthDraw.prizeAmount = MONTHLY_WIN_PRIZE;
      }
      winner.addNotification({
        type: "Monthly Draw Result",
        status: "success",
        amount: MONTHLY_WIN_PRIZE,
        message: `Monthly card result for ${month}: at least one of your 3-letter sets matched this month’s result. You can claim your reward now.`,
      });
      await winner.save({ session });
    }

    try {
      const winnerUsers = await User.find({ _id: { $in: winnerIds } }).select("email username");
      for (const user of winnerUsers) {
        await sendUserEmail({
          userId: user._id,
          type: "monthly_result",
          email: user.email,
          subject: "Monthly Card Result",
          title: "Monthly Card Result",
          bodyLines: [
            `Monthly card results for ${month} are out.`,
            "One of your 3-letter sets matched this month’s result.",
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
      draw: drawDoc || null,
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
    const user = await User.findById(req.user.id).select("monthlyDraws");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const month = normalizeMonth(req.query?.month);
    const monthlyDraw = (user.monthlyDraws || []).find((d) => d.month === month);
    const purchases = Number(monthlyDraw?.purchasesCount || 0);
    const required = 5;
    const progress = Math.min(100, (purchases / required) * 100 || 0);
    const isEligible = purchases >= required;
    const slots = await getMonthlyCardSlots(month, user._id);
    const unlockedSlots = slots.slice(0, Math.min(MONTHLY_CARD_SET_COUNT, purchases));
    const playedSlots = slots.filter((slot) => Boolean(slot.played));
    const unplayedSlots = unlockedSlots.filter((slot) => !slot.played);

    const now = new Date();
    const monthEnd = getMonthEnd(month);
    const daysLeft = Math.max(
      0,
      Math.ceil((monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    return res.json({
      success: true,
      eligibility: {
        purchases,
        required,
        progress,
        daysLeft,
        isEligible,
        setsUnlocked: unlockedSlots.length,
        setsCompleted: playedSlots.length,
        raffleTicketsTotal: unlockedSlots.length,
        raffleTicketsUnplayed: unplayedSlots.length,
        raffleTicketsPlayed: playedSlots.length,
        cardSets: slots,
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
   GET MONTHLY RAFFLE TICKETS
===================================================== */
export const getMonthlyRaffleTickets = async (req, res) => {
  try {
    const month = normalizeMonth(req.query?.month);
    const user = await User.findById(req.user.id).select("username monthlyDraws");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const monthlyDraw = (user.monthlyDraws || []).find((d) => d.month === month);
    const purchases = Number(monthlyDraw?.purchasesCount || 0);
    const slots = await getMonthlyCardSlots(month, user._id);
    const tickets = slots.map((slot) => ({
      ...slot,
      locked: slot.setIndex > Math.min(MONTHLY_CARD_SET_COUNT, purchases),
    }));

    return res.json({ success: true, month, tickets });
  } catch (error) {
    console.error("Get monthly raffle tickets error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get raffle tickets",
    });
  }
};

/* =====================================================
   PLAY MONTHLY RAFFLE TICKET
===================================================== */
export const playMonthlyRaffleTicket = async (req, res) => {
  try {
    const month = normalizeMonth(req.body?.month);
    if (isMonthClosed(month)) {
      return res.status(400).json({
        success: false,
        message: "Monthly draw already closed for this month.",
      });
    }

    const setIndexRaw = Number(req.body?.setIndex || req.body?.ticketId || 0);
    const setIndex = Number.isInteger(setIndexRaw) ? setIndexRaw : 0;
    const code = normalizeCardCode(req.body?.code || req.body?.letters || "");

    const user = await User.findById(req.user.id).select("monthlyDraws email username");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!setIndex || setIndex < 1 || setIndex > MONTHLY_CARD_SET_COUNT) {
      return res.status(400).json({
        success: false,
        message: "Invalid card set",
      });
    }

    const monthlyDraw = (user.monthlyDraws || []).find((d) => d.month === month);
    const purchases = Number(monthlyDraw?.purchasesCount || 0);
    if (purchases < setIndex) {
      return res.status(400).json({
        success: false,
        message: `Set ${setIndex} is locked until you complete ${setIndex} data purchase${setIndex === 1 ? "" : "s"} this month.`,
      });
    }

    if (code.length !== MONTHLY_CARD_SET_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Select exactly ${MONTHLY_CARD_SET_LENGTH} letters for the set.`,
      });
    }

    const unique = new Set(code.split(""));
    if (unique.size !== MONTHLY_CARD_SET_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Set ${setIndex} must contain ${MONTHLY_CARD_SET_LENGTH} unique letters.`,
      });
    }

    const existing = await MonthlyRaffleEntry.findOne({ month, user: user._id, setIndex });
    if (existing?.code) {
      return res.status(400).json({
        success: false,
        message: `Set ${setIndex} has already been submitted.`,
      });
    }

    const entry = existing || new MonthlyRaffleEntry({ month, user: user._id, setIndex, code });
    entry.code = code;
    entry.status = "pending";
    entry.playedAt = new Date();
    await entry.save();

    user.addNotification({
      type: "Monthly Draw",
      status: "success",
      message: `Set ${setIndex} entered for Monthly Card Game (${month}). Status: Pending until month end.`,
    });
    await user.save();

    return res.json({
      success: true,
      message: "Monthly card set entered",
      entry: { id: entry._id, code, month, setIndex },
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return res.status(400).json({
        success: false,
        message: "This card set has already been used",
      });
    }
    console.error("Play monthly raffle ticket error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to play card set",
    });
  }
};

/* =====================================================
   GET MONTHLY WINNERS
===================================================== */
export const getMonthlyWinners = async (req, res) => {
  try {
    const month = normalizeMonth(req.query?.month);
    await runMonthlyRaffleDrawIfDue(month);
    const draw = await MonthlyRaffleDraw.findOne({ month }).lean();
    const entries = await MonthlyRaffleEntry.find({ month })
      .select("code status user setIndex playedAt")
      .lean();
    return res.json({
      success: true,
      month,
      draw,
      entries: entries.map((e) => ({
        code: maskCode(e.code),
        status: e.status,
        user: e.user,
        setIndex: e.setIndex,
        playedAt: e.playedAt || null,
      })),
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
   CLAIM MONTHLY REWARD
===================================================== */
export const claimMonthlyReward = async (req, res) => {
  try {
    if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
      return res.status(403).json({
        success: false,
        message: "Monthly rewards are temporarily disabled for review.",
      });
    }

    const month = normalizeMonth(req.body?.month);
    await runMonthlyRaffleDrawIfDue(month);

    const draw = await MonthlyRaffleDraw.findOne({ month });
    if (!draw) {
      return res.status(404).json({
        success: false,
        message: "No monthly draw result found for this month.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const monthlyDraw = (user.monthlyDraws || []).find((d) => d.month === month);
    if (!monthlyDraw?.isWinner) {
      return res.status(403).json({
        success: false,
        message: "Only users with a winning monthly card set can claim this monthly reward.",
      });
    }

    const claimed = await user.claimMonthlyReward(month);
    if (!claimed) {
      return res.status(400).json({
        success: false,
        message: "Monthly reward already claimed or unavailable.",
      });
    }

    draw.claimed = true;
    draw.claimedAt = new Date();
    await draw.save();

    user.addNotification({
      type: "Monthly Draw",
      status: "success",
      amount: MONTHLY_WIN_PRIZE,
      message: `Monthly card reward claimed for ${month}: N${MONTHLY_WIN_PRIZE.toLocaleString()} added to reward balance.`,
    });
    await user.save();

    return res.json({
      success: true,
      message: "Monthly reward claimed successfully",
      reward: {
        month,
        amount: MONTHLY_WIN_PRIZE,
        claimedAt: draw.claimedAt,
        winningSets: draw.winningSets || [],
      },
      balance: user.rewardBalance,
    });
  } catch (error) {
    console.error("Claim monthly reward error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to claim monthly reward",
    });
  }
};/* =====================================================
   TOP PURCHASES LEADERBOARD (MONTHLY)
===================================================== */
export const getTopPurchasersLeaderboard = async (req, res) => {
  try {
    const month = normalizeMonth(req.query?.month);
    const minPurchases = 1;
    const limit = 10;
    const threshold = minPurchases;

    const rows = await User.aggregate([
      { $unwind: "$monthlyDraws" },
      {
        $match: {
          "monthlyDraws.month": month,
          "monthlyDraws.purchasesCount": { $gte: minPurchases },
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
    ]);

    const leaderboard = rows.slice(0, limit).map((row, index) => ({
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

    let myRank = null;
    if (myPurchases >= minPurchases) {
      const higher = rows.filter((row) => {
        if (row.purchasesCount > myPurchases) return true;
        if (row.purchasesCount < myPurchases) return false;
        const rowDate = row.lastPurchaseDate ? new Date(row.lastPurchaseDate).getTime() : 0;
        const myDate = mine?.lastPurchaseDate ? new Date(mine.lastPurchaseDate).getTime() : 0;
        if (rowDate < myDate) return true;
        if (rowDate > myDate) return false;
        return String(row._id) < String(user._id);
      }).length;
      myRank = higher + 1;
    }

    return res.json({
      success: true,
      month,
      threshold,
      leaderboard,
      myPurchases,
      qualified: myPurchases >= threshold,
      myRank,
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












