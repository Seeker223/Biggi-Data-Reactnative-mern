// backend/controllers/dataPurchaseController.js
import DataPlan from "../models/DataPlan.js";
import User from "../models/User.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";

export const buyData = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, msg: "Not authorized" });
    }

    const { plan_id, mobile_no } = req.body;

    if (!plan_id || !mobile_no) {
      return res.status(400).json({
        success: false,
        msg: "plan_id and mobile_no required",
      });
    }

    // Normalize incoming plan_id
    const normalizedPlanId = (plan_id || "").trim().toLowerCase();

    // --- Debugging (Optional) ---
    console.log("📦 Incoming plan_id:", normalizedPlanId);

    // Fetch plan
    const plan = await DataPlan.findOne({
      plan_id: normalizedPlanId,
      active: true,
    });

    if (!plan) {
      console.log("❌ Plan not found:", normalizedPlanId);
      return res.status(404).json({
        success: false,
        msg: "Invalid plan — plan_id not found in DB",
      });
    }

    // Fetch user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    const amount = Number(plan.amount);

    // Check wallet balance
    if (user.mainBalance < amount) {
      return res.status(400).json({
        success: false,
        msg: "Insufficient balance",
      });
    }

    // Deduct user balance
    user.mainBalance -= amount;
    await user.save();

    const reference = generateReference();

    const payload = {
      mobile_no,
      plan_id: plan.zenipoint_code, // Zenipoint expects *their* code
      reference,
    };

    // ---- CALL ZENIPOINT API ----
    const response = await zenipointPost("/data/buy", payload);
    const zen = response?.data;

    // Local test mode
    if (zen?.mode === "LOCAL_TEST_MODE") {
      return res.status(200).json({
        success: true,
        msg: "Simulated success (LOCAL_TEST_MODE)",
        reference,
        plan,
        newBalance: user.mainBalance,
      });
    }

    // Live success
    if (zen?.status === "success" || zen?.code === 200) {
      return res.status(200).json({
        success: true,
        msg: "Data purchased successfully",
        reference,
        plan,
        zenipoint: zen,
        newBalance: user.mainBalance,
      });
    }

    // Zenipoint rejected → REFUND
    user.mainBalance += amount;
    await user.save();

    return res.status(400).json({
      success: false,
      msg: zen?.message || "Zenipoint rejected transaction",
      zenipoint: zen,
    });
  } catch (err) {
    console.error("ZENIPOINT ERROR:", err.response?.data || err.message);

    // ----------- REFUND ON ERROR -----------
    try {
      const normalizedPlanId = (req.body.plan_id || "").trim().toLowerCase();
      const plan = await DataPlan.findOne({ plan_id: normalizedPlanId });

      if (plan) {
        const user = await User.findById(req.user.id);
        if (user) {
          user.mainBalance += Number(plan.amount);
          await user.save();
        }
      }
    } catch (refundError) {
      console.error("Refund Error:", refundError.message);
    }

    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
      error: err.response?.data || err.message,
    });
  }
};
