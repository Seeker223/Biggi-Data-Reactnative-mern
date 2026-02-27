import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

const getMonthEnd = (date) => {
  const ref = date instanceof Date ? date : new Date(date);
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
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
    message: `${winner.username || "Your referral"} won ${gameLabel}. You earned ₦${bonus.toLocaleString()}.`,
  });

  await referrer.save();
  return bonus;
};

// ---------------------------------------------------
// 🎮 PLAY DAILY GAME (User selects 5 numbers)
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
    await awardReferralReward({
      winner: user,
      prizeAmount: prize,
      gameLabel: "Weekly Draw",
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

    const prize = Number(game.prizeAmount || 2000);
    game.claimed = true;
    game.claimedAt = new Date();
    user.rewardBalance += prize;
    user.totalPrizeWon += prize;
    user.totalWins = Number(user.totalWins || 0) + 1;

    await user.save();

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
// 🎯 GENERATE WINNING NUMBERS & EVALUATE WINNERS
// ---------------------------------------------------
export const generateDailyWinningNumbers = async () => {
  try {
    // Generate 5 unique winning numbers between 1–70
    const winningNumbers = [];
    while (winningNumbers.length < 5) {
      const num = Math.floor(Math.random() * 52) + 1;
      if (!winningNumbers.includes(num)) winningNumbers.push(num);
    }

    console.log("🎯 Weekly winning numbers:", winningNumbers);

    // Fetch users with unsettled entries.
    const users = await User.find({ "dailyNumberDraw.result": { $size: 0 } });

    for (const user of users) {
      let updated = false;

      user.dailyNumberDraw.forEach((entry) => {
        if (entry.result.length === 0) {
          const playedAt = new Date(entry.createdAt || entry.playedAt || Date.now());
          const monthEnd = getMonthEnd(playedAt);
          if (Date.now() < monthEnd.getTime()) return;

          // Not yet evaluated
          entry.result = winningNumbers;

          // Check if user matched all 5 numbers
          const isWinner =
            entry.numbers.length === winningNumbers.length &&
            entry.numbers.every((n) => winningNumbers.includes(n));

          entry.isWinner = isWinner;

          // Do not auto-credit here; reward is claimed manually (one per month enforced on claim)

          updated = true;
        }
      });

      if (updated) await user.save();
    }

    return winningNumbers;
  } catch (error) {
    console.log("Daily Game Result Error:", error);
  }
};
