import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

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
        message: "You must select exactly 5 numbers",
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

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Your numbers were submitted successfully",
      tickets: user.tickets,
    });
  } catch (error) {
    console.log("Daily Game Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
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
      const num = Math.floor(Math.random() * 70) + 1;
      if (!winningNumbers.includes(num)) winningNumbers.push(num);
    }

    console.log("🎯 Today's Winning Numbers:", winningNumbers);

    // Fetch all users who played today
    const users = await User.find({ "dailyNumberDraw.result": { $size: 0 } });

    for (const user of users) {
      let updated = false;

      user.dailyNumberDraw.forEach((entry) => {
        if (entry.result.length === 0) {
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
