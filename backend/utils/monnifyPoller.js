// utils/monnifyPoller.js
import cron from "node-cron";
import Deposit from "../models/Deposit.js";
import User from "../models/User.js";
import { verifyMonnifyTransaction } from "./monnify.js";

export const startMonnifyPolling = () => {
  console.log("Monnify poller started...");

  // Runs every 30 seconds
  cron.schedule("*/30 * * * * *", async () => {
    try {
      const pendingDeposits = await Deposit.find({ status: "PENDING" });

      if (!pendingDeposits.length) return;

      console.log(`Polling Monnify → Found ${pendingDeposits.length} pending deposits`);

      for (const dep of pendingDeposits) {
        const check = await verifyMonnifyTransaction(dep.reference);

        if (check.paymentStatus === "PAID") {
          console.log(`✓ Payment confirmed by polling: ${dep.reference}`);

          const user = await User.findById(dep.userId);
          if (!user) continue;

          // Update user balance
          user.mainBalance += dep.amount;
          await user.save();

          // Update deposit status
          dep.status = "SUCCESS";
          dep.gatewayResponse = check;
          await dep.save();
        }
      }
    } catch (error) {
      console.log("Monnify polling error:", error.message);
    }
  });
};
