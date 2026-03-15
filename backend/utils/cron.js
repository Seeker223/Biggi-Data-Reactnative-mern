// utils/cron.js
import { CronJob } from "cron";
import https from "https";
import http from "http";
import { generateDailyWinningNumbers } from "../controllers/dailyGameController.js";
import { runMonthlyRaffleDrawIfDue, getPreviousMonthString } from "../controllers/monthlyGameController.js";
import { runProfitSweep } from "./profitSweep.js";

/* ---------------------------------------------------------
   1. KEEP-ALIVE PING (Render - every 14 minutes)
--------------------------------------------------------- */

const KEEP_ALIVE_URL = process.env.API_URL;
// Example in .env:
// API_URL=https://biggi-data-reactnative-mern.onrender.com/

if (!KEEP_ALIVE_URL) {
  console.warn("âš ï¸ No API_URL set â€” Keep-alive cron disabled.");
}

const keepAliveJob = new CronJob("*/14 * * * *", () => {
  if (!KEEP_ALIVE_URL) return;

  console.log(`[CRON] Pinging keep-alive URL â†’ ${KEEP_ALIVE_URL}`);

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

// Weekly letter draw results are settled at month end and must be identical for all users.

const dailyGameJob = new CronJob(
  "1 0 * * *", // Run at 00:01 AM daily
  async () => {
    try {
      await generateDailyWinningNumbers();
      return;
      console.log("ðŸŽ¯ [CRON] Running Weekly Result Settlement...");

      const winningNumbers = generateWinningNumbers();
      console.log("ðŸŽ‰ Weekly Winning Numbers:", winningNumbers);

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

      console.log("âœ… Weekly result settlement completed successfully.");
    } catch (err) {
      console.error("âŒ Weekly Result Settlement Cron Error:", err);
    }
  },
  null,
  true
);


/* ---------------------------------------------------------
   3. MONTHLY RAFFLE DRAW (Checks daily at 00:05 AM)
--------------------------------------------------------- */

const monthlyRaffleJob = new CronJob(
  "5 0 * * *",
  async () => {
    try {
      const month = getPreviousMonthString();
      console.log(`[CRON] Monthly raffle draw check -> ${month}`);
      await runMonthlyRaffleDrawIfDue(month);
    } catch (err) {
      console.error("[CRON] Monthly raffle draw error:", err);
    }
  },
  null,
  true
);

/* ---------------------------------------------------------
   4. PROFIT SWEEP (Checks daily at 23:55 Africa/Lagos)
--------------------------------------------------------- */

const profitSweepJob = new CronJob(
  "55 23 * * *",
  async () => {
    try {
      console.log("[CRON] Profit sweep check...");
      await runProfitSweep({ force: false });
    } catch (err) {
      console.error("[CRON] Profit sweep error:", err);
    }
  },
  null,
  true,
  "Africa/Lagos"
);
/* ---------------------------------------------------------
   3. AUTO-START CRONS (prevent double-start on hot reload)
--------------------------------------------------------- */

if (!keepAliveJob.running) keepAliveJob.start();
if (!dailyGameJob.running) dailyGameJob.start();
if (!monthlyRaffleJob.running) monthlyRaffleJob.start();
if (!profitSweepJob.running) profitSweepJob.start();

console.log("â±ï¸ CRON SERVICE RUNNING...");

export default { keepAliveJob, dailyGameJob, monthlyGameJob: dailyGameJob, monthlyRaffleJob, profitSweepJob };




