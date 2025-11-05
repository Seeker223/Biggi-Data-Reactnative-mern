// utils/cron.js (Refined ESM)

// Change: import cron from "cron";
// To: Import the specific class CronJob from the 'cron' package
import { CronJob } from "cron"; 
import https from "https"; // Correct for built-in module

const job = new CronJob("*/14 * * * *", function () { // Use the imported class directly
  https
    .get(process.env.API_URL, (res) => {
      if (res.statusCode === 200) console.log("GET request sent successfully");
      else console.log("GET request failed", res.statusCode);
    })
    .on("error", (e) => console.error("Error while sending request", e));
});

// The default export remains correct
export default job;