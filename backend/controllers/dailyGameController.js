import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";
import WeeklyLetterDrawResult from "../models/WeeklyLetterDrawResult.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const getMonthEnd = (date) => {
  const ref = date instanceof Date ? date : new Date(date);
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
};

const getMonthKey = (date) => {
  const ref = date instanceof Date ? date : new Date(date);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
};

const generateWinningNumbers = () => {
  const nums = new Set();
  while (nums.size < 5) nums.add(Math.floor(Math.random() * 52) + 1);
  return [...nums];
};

const getOrCreateMonthlyResult = async (monthKey) => {
  const existing = await WeeklyLetterDrawResult.findOne({ month: monthKey }).lean();
  if (existing?.winningNumbers?.length === 5) return existing.winningNumbers;

  const winningNumbers = generateWinningNumbers();
  try {
    const created = await WeeklyLetterDrawResult.create({
      month: monthKey,
      winningNumbers,
      generatedAt: new Date(),
    });
    return created.winningNumbers;
  } catch (err) {
    // In case of race across processes.
    if (err?.code === 11000) {
      const retry = await WeeklyLetterDrawResult.findOne({ month: monthKey }).lean();
      if (retry?.winningNumbers?.length === 5) return retry.winningNumbers;
    }
    throw err;
  }
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
    message: `${winner.username || "Your referral"} won ${gameLabel}. You earned â‚¦${bonus.toLocaleString()}.`,
  });

  await referrer.save();
  return bonus;
};

// ---------------------------------------------------
// ðŸŽ® PLAY DAILY GAME (User selects 5 numbers)
// ---------------------------------------------------
export const playDailyGame = async (req, res) => {
  try {
    const userId = req.user.id;
    const { numbers } = req.body;

    if (!numbers || !Array.isArray(numbers) || numbers.length !== 5) {
      return res.status(400).json({
        success: false,
        message: "You must select exactly 5 letters",
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Must have at least 1 ticket
    if (user.tickets <= 0) {
      return res.status(400).json({
        success: false,
        message: "You do not have any tickets left",
      });
    }

    // Deduct ticket
    user.tickets -= 1;

    // Save play entry
    user.dailyNumberDraw.push({
      numbers,
      result: [],
      isWinner: false,
      playedAt: new Date(),
    });

    user.addNotification({
      type: "Weekly Draw",
      status: "success",
      message: "Weekly draw entry submitted successfully. Results are released at month end.",
    });

    await user.save();

    await sendUserEmail({
      email: user.email,
      subject: "Weekly Draw Entry Submitted",
      title: "Weekly Draw Entry Submitted",
      bodyLines: [
        "Your weekly draw entry has been submitted successfully.",
        "Results are released at month end.",
      ],
    });


    return res.status(200).json({
      success: true,
      message: "Your letters were submitted successfully. Results are released at month end.",
      tickets: user.tickets,
    });
  } catch (error) {
    console.log("Daily Game Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------------------------------------------------
// CLAIM DAILY REWARD (moves won amount to reward balance)
// ---------------------------------------------------
export const claimDailyReward = async (req, res) => {
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Daily reward claiming is temporarily disabled for review.",
    });
  }

  try {
    const userId = req.user.id;
    const { gameId } = req.body;

    if (!gameId) {
      return res.status(400).json({
        success: false,
        message: "gameId is required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const game = user.dailyNumberDraw.id(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: "Daily game record not found",
      });
    }

    if (!game.isWinner) {
      return res.status(400).json({
        success: false,
        message: "This ticket is not a winning ticket",
      });
    }

    if (game.claimed) {
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
      });
    }

    // Allow only one weekly reward per calendar month
    const gameDate = new Date(game.createdAt || game.playedAt || Date.now());
    const monthKey = `${gameDate.getFullYear()}-${String(gameDate.getMonth() + 1).padStart(2, "0")}`;
    const alreadyClaimedThisMonth = (user.dailyNumberDraw || []).some((entry) => {
      if (!entry?.claimed) return false;
      const entryDate = new Date(entry.createdAt || entry.playedAt || Date.now());
      const entryKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, "0")}`;
      return entryKey === monthKey;
    });

    if (alreadyClaimedThisMonth) {
      return res.status(400).json({
        success: false,
        message: "You can claim only one weekly reward per month",
      });
    }

    const prize = Number(game.prizeAmount || 10000);
    game.claimed = true;
    game.claimedAt = new Date();
    user.rewardBalance += prize;
    user.totalPrizeWon += prize;
    user.totalWins = Number(user.totalWins || 0) + 1;

    await user.save();

    await awardReferralReward({
      winner: user,
      prizeAmount: prize,
      gameLabel: "Weekly Draw",
    });

    await sendUserEmail({
      email: user.email,
      subject: "Weekly Reward Claimed",
      title: "Reward Claimed",
      bodyLines: [
        `You claimed N${Number(prize).toLocaleString()} from the weekly draw.`,
        "Your reward balance has been updated.",
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Daily reward claimed successfully",
      claimedAmount: prize,
      rewardBalance: user.rewardBalance,
      mainBalance: user.mainBalance,
      gameId: game._id,
      claimedAt: game.claimedAt,
    });
  } catch (error) {
    console.log("Daily reward claim error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to claim daily reward",
    });
  }
};

// ---------------------------------------------------
// ðŸŽ¯ GENERATE WINNING NUMBERS & EVALUATE WINNERS
// ---------------------------------------------------
export const generateDailyWinningNumbers = async () => {
  try {
    // Fetch users with unsettled entries.
    const users = await User.find({ "dailyNumberDraw.result": { $size: 0 } });

    for (const user of users) {
      let updated = false;
      const emailLines = [];

      for (const entry of user.dailyNumberDraw || []) {
        if (!Array.isArray(entry?.result) || entry.result.length > 0) continue;

        const playedAt = new Date(entry.createdAt || entry.playedAt || Date.now());
        const monthEnd = getMonthEnd(playedAt);
        if (Date.now() < monthEnd.getTime()) continue;

        // Central per-month result: all users share the same winning letters for the month.
        const monthKey = getMonthKey(playedAt);
        const winningNumbers = await getOrCreateMonthlyResult(monthKey);

        entry.result = winningNumbers;

        const isWinner =
          entry.numbers.length === winningNumbers.length &&
          entry.numbers.every((n) => winningNumbers.includes(n));

        entry.isWinner = isWinner;
        updated = true;

        const playedAtLabel = entry?.playedAt
          ? new Date(entry.playedAt).toLocaleDateString()
          : "this month";
        if (isWinner) {
          emailLines.push(`Great news! Your weekly draw entry from ${playedAtLabel} is a WINNER.`);
        } else {
          emailLines.push(`Your weekly draw entry from ${playedAtLabel} did not win this time.`);
        }
      }

      if (updated) {
        await user.save();
        if (emailLines.length) {
          await sendUserEmail({
            email: user.email,
            subject: "Weekly Draw Result",
            title: "Weekly Draw Result",
            bodyLines: emailLines,
          });
        }
      }
    }

    return true;
  } catch (error) {
    console.log("Daily Game Result Error:", error);
  }
};

// ---------------------------------------------------
// GET WEEKLY WINNERS (live, per-month view)
// Returns at most 1 win per user for the month (latest).
// ---------------------------------------------------
export const getWeeklyWinners = async (req, res) => {
  try {
    const rawMonth = String(req.query?.month || "").trim(); // "YYYY-MM"
    const now = new Date();
    const monthKey =
      /^\d{4}-\d{2}$/.test(rawMonth)
        ? rawMonth
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [yearStr, monthStr] = monthKey.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);

    const winners = await User.aggregate([
      { $unwind: "$dailyNumberDraw" },
      {
        $match: {
          "dailyNumberDraw.isWinner": true,
          "dailyNumberDraw.createdAt": { $gte: start, $lt: end },
        },
      },
      { $sort: { "dailyNumberDraw.createdAt": -1 } },
      {
        $group: {
          _id: "$_id",
          username: { $first: "$username" },
          email: { $first: "$email" },
          photo: { $first: "$photo" },
          gameId: { $first: "$dailyNumberDraw._id" },
          createdAt: { $first: "$dailyNumberDraw.createdAt" },
          playedAt: { $first: "$dailyNumberDraw.playedAt" },
          numbers: { $first: "$dailyNumberDraw.numbers" },
          result: { $first: "$dailyNumberDraw.result" },
          prizeAmount: { $first: "$dailyNumberDraw.prizeAmount" },
          claimed: { $first: "$dailyNumberDraw.claimed" },
          claimedAt: { $first: "$dailyNumberDraw.claimedAt" },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 100 },
    ]);

    return res.status(200).json({
      success: true,
      month: monthKey,
      count: winners.length,
      winners: winners.map((w) => ({
        userId: w._id,
        username: w.username,
        email: w.email,
        photo: w.photo || null,
        gameId: w.gameId,
        createdAt: w.createdAt || w.playedAt || null,
        numbers: w.numbers || [],
        result: w.result || [],
        prizeAmount: Number(w.prizeAmount || 10000),
        claimed: Boolean(w.claimed),
        claimedAt: w.claimedAt || null,
      })),
    });
  } catch (error) {
    console.log("Get weekly winners error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch weekly winners",
    });
  }
};


