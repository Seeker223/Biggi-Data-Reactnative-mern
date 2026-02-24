// utils/cron.js
import { CronJob } from "cron";
import https from "https";
import http from "http";
import User from "../models/User.js";

/* ---------------------------------------------------------
   1. KEEP-ALIVE PING (Render - every 14 minutes)
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   2. DAILY GAME DRAW (Runs every day at 00:01 AM)
--------------------------------------------------------- */

// Generate 5 unique winning numbers between 1–70
function generateWinningNumbers() {
  const nums = new Set();
  while (nums.size < 5) {
    nums.add(Math.floor(Math.random() * 52) + 1);
  }
  return [...nums];
}

const dailyGameJob = new CronJob(
  "1 0 * * *", // Run at 00:01 AM daily
  async () => {
    try {
      console.log("🎯 [CRON] Running Daily Game Draw...");

      const winningNumbers = generateWinningNumbers();
      console.log("🎉 Today’s Winning Numbers:", winningNumbers);

      // Find all users who played within last 24 hours
      const users = await User.find();

      for (const user of users) {
        if (!user.dailyNumberDraw.length) continue;

        let mustSave = false;

        user.dailyNumberDraw.forEach((entry) => {
          const diff = Date.now() - new Date(entry.createdAt).getTime();

          // Ignore entries older than 24 hours
          if (diff > 24 * 60 * 60 * 1000) return;

          entry.result = winningNumbers;

          // Check if all 5 selected are inside winning numbers
          const matchedAll = entry.numbers.every((n) =>
            winningNumbers.includes(n)
          );

          entry.isWinner = matchedAll;

          if (matchedAll) {
            user.rewardBalance += 500; // reward for perfect match
            user.notifications += 1;   // notify user
          }

          mustSave = true;
        });

        if (mustSave) {
          await user.save();
        }
      }

      console.log("✅ Daily game draw completed successfully.");
    } catch (err) {
      console.error("❌ Daily Game Cron Error:", err);
    }
  },
  null,
  true
);

/* ---------------------------------------------------------
   3. AUTO-START CRONS (prevent double-start on hot reload)
--------------------------------------------------------- */

if (!keepAliveJob.running) keepAliveJob.start();
if (!dailyGameJob.running) dailyGameJob.start();

console.log("⏱️ CRON SERVICE RUNNING...");

export default { keepAliveJob, dailyGameJob };
