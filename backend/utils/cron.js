// utils/cron.js
import { CronJob } from "cron";
import https from "https";
import http from "http";

const KEEP_ALIVE_URL = process.env.API_URL; // Example: "https://biggi-data-reactnative-mern.onrender.com/"

// Ensure your .env contains:
// API_URL=https://biggi-data-reactnative-mern.onrender.com/

if (!KEEP_ALIVE_URL) {
  console.warn("⚠️ No API_URL set in environment variables — keep-alive cron will not run.");
}

// Define job to run every 14 minutes
const job = new CronJob("*/14 * * * *", () => {
  if (!KEEP_ALIVE_URL) return;

  console.log(`[CRON] Sending keep-alive ping to ${KEEP_ALIVE_URL}...`);

  const client = KEEP_ALIVE_URL.startsWith("https") ? https : http;

  const req = client.get(KEEP_ALIVE_URL, (res) => {
    const status = res.statusCode;
    if (status === 200) {
      console.log("[CRON] ✅ Render keep-alive successful (200 OK)");
    } else {
      console.warn(`[CRON] ⚠️ Render keep-alive returned ${status}`);
    }
    res.resume(); // Drain data to free up memory
  });

  req.on("error", (err) => {
    console.error("[CRON] ❌ Keep-alive request failed:", err.message);
  });

  req.end();
});

// Auto-start safeguard: ensures job runs even if index.js forgets to call start()
if (!job.running) job.start();

export default job;
