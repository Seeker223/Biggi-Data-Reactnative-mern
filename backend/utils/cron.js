// utils/cron.js
import { CronJob } from "cron";
import https from "https";
import http from "http";
import User from "../models/User.js";

// ---------------------------------------------------------------------
// 1. KEEP-ALIVE PING (Every 14 minutes for Render)
// ---------------------------------------------------------------------

const KEEP_ALIVE_URL = process.env.API_URL; 
// Example in .env:
// API_URL=https://biggi-data-reactnative-mern.onrender.com/

if (!KEEP_ALIVE_URL) {
  console.warn("⚠️ No API_URL set — Keep-alive cron disabled.");
}

const keepAliveJob = new CronJob("*/14 * * * *", () => {
  if (!KEEP_ALIVE_URL) return;

  console.log(`[CRON] Pinging keep-alive URL → ${KEEP_ALIVE_URL}`);

  const client = KEEP_ALIVE_URL.startsWith("https") ? https : http;

  const req = client.get(KEEP_ALIVE_URL, (res) => {
    console.log(`[CRON] Keep-alive status: ${res.statusCode}`);
    res.resume();
  });

  req.on("error", (err) => {
    console.error("[CRON] Keep-alive failed:", err.message);
  });

  req.end();
});


// ---------------------------------------------------------------------
// 2. DAILY GAME DRAW (Runs every day at 00:01)
// ---------------------------------------------------------------------

// Generate 5 winning numbers between 1–50
function generateWinningNumbers() {
  const nums = new Set();
  while (nums.size < 5) {
    nums.add(Math.floor(Math.random() * 50) + 1);
  }
  return [...nums];
}

const dailyGameJob = new CronJob(
  "1 0 * * *", // Runs daily at 00:01
  async () => {
    try {
      console.log("🎯 [CRON] Running Daily Game Draw...");

      const winningNumbers = generateWinningNumbers();
      console.log("🎉 Winning numbers:", winningNumbers);

      const users = await User.find();

      for (const user of users) {
        if (!user.dailyNumberDraw.length) continue;

        let updated = false;

        user.dailyNumberDraw.forEach((draw) => {
          // Only process plays from the last 24 hours
          const diff = Date.now() - new Date(draw.createdAt).getTime();
          if (diff > 24 * 60 * 60 * 1000) return;

          draw.result = winningNumbers;

          const matched = draw.numbers.every((n) =>
            winningNumbers.includes(n)
          );

          draw.isWinner = matched;

          if (matched) {
            user.rewardBalance += 500; // You can change reward amount
          }

          updated = true;
        });

        if (updated) await user.save();
      }

      console.log("✅ Daily game draw completed and user results updated.");
    } catch (err) {
      console.error("❌ Daily game cron error:", err);
    }
  },
  null,
  true
);


// ---------------------------------------------------------------------
// 3. AUTO-START BOTH CRONS
// ---------------------------------------------------------------------
if (!keepAliveJob.running) keepAliveJob.start();
if (!dailyGameJob.running) dailyGameJob.start();

export default { keepAliveJob, dailyGameJob };
