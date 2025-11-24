import DataPlan from "../models/DataPlan.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";
import { logWalletTransaction, syncWalletBalance } from "../utils/wallet.js";

/**
 * Buy data bundle (production-ready)
 * - Uses plan.zenipoint_code
 * - Deducts user.mainBalance, logs transaction, calls Zenipoint
 * - Adds ticket reward on success
 * - Refunds on failure
 */
export const buyData = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, msg: "Not authorized" });

    const { plan_id, mobile_no } = req.body;
    if (!plan_id || !mobile_no)
      return res.status(400).json({ success: false, msg: "plan_id and mobile_no required" });

    const normalizedPlanId = plan_id.trim().toLowerCase();
    const plan = await DataPlan.findOne({ plan_id: normalizedPlanId, active: true });
    if (!plan) return res.status(404).json({ success: false, msg: "Plan not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    const amount = Number(plan.amount);
    if (user.mainBalance < amount)
      return res.status(400).json({ success: false, msg: "Insufficient balance" });

    // Create reference and prepare payload
    const reference = generateReference();
    const payload = { mobile_no, plan_id: plan.zenipoint_code, reference };

    // Deduct user balance (optimistic)
    user.mainBalance -= amount;
    await user.save();

    // Sync wallet balance and log pending purchase
    await syncWalletBalance(userId);
    await logWalletTransaction(userId, "purchase", amount, reference, "pending");

    let zenResponse;
    try {
      const response = await zenipointPost("/data", payload);
      zenResponse = response.data;
      console.log("Zenipoint raw response:", zenResponse);
    } catch (apiErr) {
      // Refund on network/API error
      user.mainBalance += amount;
      await user.save();
      await syncWalletBalance(userId);
      await logWalletTransaction(userId, "purchase", amount, reference, "failed");

      return res.status(500).json({
        success: false,
        msg: "Zenipoint transaction failed",
        error: apiErr.message || apiErr.response?.data,
      });
    }

    // If simulated fallback
    if (zenResponse?.mode === "LOCAL_TEST_MODE") {
      await logWalletTransaction(userId, "purchase", amount, reference, "simulated");

      // Add ticket for simulated purchase
      user.tickets = (user.tickets || 0) + 1;
      await user.save();

      return res.status(200).json({
        success: true,
        msg: "Simulated success (LOCAL_TEST_MODE)",
        reference,
        plan,
        newBalance: user.mainBalance,
        tickets: user.tickets,
        zenipoint: zenResponse,
      });
    }

    // Live success
    if (zenResponse?.status === "success" || zenResponse?.code === 200) {
      await logWalletTransaction(userId, "purchase", amount, reference, "success");

      // Add ticket reward
      user.tickets = (user.tickets || 0) + 1; // Or plan.ticketReward if variable
      await user.save();

      return res.status(200).json({
        success: true,
        msg: zenResponse.message || "Data purchased successfully",
        reference,
        plan,
        zenipoint: zenResponse,
        newBalance: user.mainBalance,
        tickets: user.tickets,
      });
    }

    // Zenipoint rejected (e.g., insufficient zeni wallet) => refund and log failed
    user.mainBalance += amount;
    await user.save();
    await syncWalletBalance(userId);
    await logWalletTransaction(userId, "purchase", amount, reference, "failed");

    return res.status(400).json({
      success: false,
      msg: zenResponse?.message || "Zenipoint rejected transaction",
      zenipoint: zenResponse,
    });
  } catch (err) {
    console.error("BUY DATA ERROR:", err);
    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
      error: err.message || err.response?.data,
    });
  }
};
