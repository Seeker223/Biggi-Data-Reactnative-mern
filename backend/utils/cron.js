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
   2. WEEKLY RESULT SETTLEMENT (Checks every day at 00:01 AM)
--------------------------------------------------------- */

const WEEKLY_RESULT_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

// Generate 5 unique winning numbers between 1 and 52
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
      console.log("🎯 [CRON] Running Weekly Result Settlement...");

      const winningNumbers = generateWinningNumbers();
      console.log("🎉 Weekly Winning Numbers:", winningNumbers);

      // Find users with plays and settle only entries that are at least 7 days old.
      const users = await User.find();

      for (const user of users) {
        if (!user.dailyNumberDraw.length) continue;

        let mustSave = false;

        user.dailyNumberDraw.forEach((entry) => {
          const diff = Date.now() - new Date(entry.createdAt).getTime();

          if (Array.isArray(entry.result) && entry.result.length > 0) return;
          if (diff < WEEKLY_RESULT_WAIT_MS) return;

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

      console.log("✅ Weekly result settlement completed successfully.");
    } catch (err) {
      console.error("❌ Weekly Result Settlement Cron Error:", err);
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
