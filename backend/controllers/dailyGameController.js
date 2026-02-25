import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

const getMonthEnd = (date) => {
  const ref = date instanceof Date ? date : new Date(date);
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
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

          // 🚩 Feature flag: Do not award rewards during Play Store review
          if (isWinner && !FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
            user.rewardBalance += 5000; // You can set reward amount
          }

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
