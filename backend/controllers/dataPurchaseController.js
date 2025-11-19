// backend/controllers/dataPurchaseController.js
import DataPlan from "../models/DataPlan.js";
import User from "../models/User.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";

const LIVE = process.env.ZENI_LIVE === "true";

/**
 * POST /api/v1/data/buy
 * LOCAL & PRODUCTION (Zenipoint Live) READY
 */
export const buyData = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, msg: "Unauthorized" });

    const { plan_id, mobile_no } = req.body;
    if (!plan_id || !mobile_no) {
      return res.status(400).json({
        success: false,
        msg: "plan_id and mobile_no are required",
      });
    }

    // Get plan from DB
    const plan = await DataPlan.findOne({ plan_id });
    if (!plan)
      return res.status(404).json({ success: false, msg: "Invalid plan" });

    // Check zenipoint_code (needed for live mode)
    if (LIVE && !plan.zenipoint_code) {
      return res.status(400).json({
        success: false,
        msg: "Plan has no Zenipoint code",
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    const amount = Number(plan.amount);
    if (user.mainBalance < amount) {
      return res.status(400).json({ success: false, msg: "Insufficient balance" });
    }

    // Deduct user balance
    user.mainBalance -= amount;
    await user.save();

    const reference = generateReference();

    // ==========================================================
    //  🔥 LOCAL TEST MODE — SKIP ZENIPOINT COMPLETELY
    // ==========================================================
    if (!LIVE) {
      return res.status(200).json({
        success: true,
        mode: "LOCAL_TEST_MODE",
        msg: "Data purchase simulated successfully",
        reference,
        plan: {
          plan_id: plan.plan_id,
          name: plan.name,
          amount: plan.amount,
        },
        newBalance: user.mainBalance,
      });
    }

    // ==========================================================
    //  🔥 LIVE MODE — SEND REAL REQUEST TO ZENIPOINT
    // ==========================================================
    const payload = {
      mobile_no,
      plan_id: plan.zenipoint_code,
      reference,
    };

    const zeniRes = await zenipointPost("/data", payload);
    const zen = zeniRes.data;

    const successOk =
      zen?.status === "success" ||
      zen?.code === 200 ||
      zen?.data?.status === "success";

    if (successOk) {
      return res.status(200).json({
        success: true,
        mode: "LIVE_MODE",
        msg: zen.message || "Data purchase successful",
        reference,
        plan: {
          plan_id: plan.plan_id,
          name: plan.name,
          amount: plan.amount,
        },
        zenipoint: zen,
        newBalance: user.mainBalance,
      });
    }

    // ❌ Zenipoint returned failure → Refund user
    user.mainBalance += amount;
    await user.save();

    return res.status(400).json({
      success: false,
      msg: zen.message || "Zenipoint transaction failed",
      zenipoint: zen,
    });

  } catch (err) {
    console.error("DATA PURCHASE ERROR:", err.response?.data || err.message);

    // Refund on crash
    try {
      const { plan_id } = req.body;
      const plan = await DataPlan.findOne({ plan_id });

      if (plan) {
        const u = await User.findById(req.user.id);
        if (u) {
          u.mainBalance += Number(plan.amount);
          await u.save();
        }
      }
    } catch (refundErr) {
      console.error("Refund failed:", refundErr);
    }

    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
      error: err.response?.data || err.message,
    });
  }
};
