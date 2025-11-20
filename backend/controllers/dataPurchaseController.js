// backend/controllers/dataPurchaseController.js
import DataPlan from "../models/DataPlan.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";

/**
 * Buy data bundle
 */
export const buyData = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, msg: "Not authorized" });

    const { plan_id, mobile_no } = req.body;
    if (!plan_id || !mobile_no)
      return res
        .status(400)
        .json({ success: false, msg: "plan_id and mobile_no required" });

    const normalizedPlanId = plan_id.trim().toLowerCase();

    // Fetch plan
    const plan = await DataPlan.findOne({ plan_id: normalizedPlanId, active: true });
    if (!plan)
      return res.status(404).json({ success: false, msg: "Plan not found" });

    // Fetch user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    const amount = Number(plan.amount);

    if (user.mainBalance < amount)
      return res.status(400).json({ success: false, msg: "Insufficient balance" });

    // Deduct user balance
    user.mainBalance -= amount;
    await user.save();

    const reference = generateReference();
    const payload = { mobile_no, plan_id: plan.zenipoint_code, reference };

    let zenResponse;

    try {
      const response = await zenipointPost("/data/buy", payload);
      zenResponse = response.data;
    } catch (apiErr) {
      // Refund on API/network failure
      user.mainBalance += amount;
      await user.save();
      await logTransaction(userId, "purchase", amount, reference, "failed");

      return res.status(500).json({
        success: false,
        msg: "Zenipoint transaction failed",
        error: apiErr.message || apiErr.response?.data,
      });
    }

    // Local test mode
    if (zenResponse?.mode === "LOCAL_TEST_MODE") {
      await logTransaction(userId, "purchase", amount, reference, "simulated");
      return res.status(200).json({
        success: true,
        msg: "Simulated success (LOCAL_TEST_MODE)",
        reference,
        plan,
        newBalance: user.mainBalance,
      });
    }

    // Zenipoint live success
    if (zenResponse?.status === "success" || zenResponse?.code === 200) {
      await logTransaction(userId, "purchase", amount, reference, "success");
      return res.status(200).json({
        success: true,
        msg: "Data purchased successfully",
        reference,
        plan,
        zenipoint: zenResponse,
        newBalance: user.mainBalance,
      });
    }

    // Zenipoint rejected → refund
    user.mainBalance += amount;
    await user.save();
    await logTransaction(userId, "purchase", amount, reference, "failed");

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

/**
 * Logs wallet transaction and syncs wallet balance with User.mainBalance
 */
async function logTransaction(userId, type, amount, reference, status) {
  try {
    const wallet = await Wallet.findOne({ userId, type: "main" });
    if (!wallet) {
      await Wallet.create({
        userId,
        type: "main",
        balance: 0,
        transactions: [{ type, amount, date: new Date(), status, reference }],
      });
      return;
    }

    const user = await User.findById(userId);
    wallet.balance = user?.mainBalance || wallet.balance;
    wallet.transactions.push({ type, amount, date: new Date(), status, reference });
    await wallet.save();
  } catch (err) {
    console.error("Transaction log failed:", err.message);
  }
}
