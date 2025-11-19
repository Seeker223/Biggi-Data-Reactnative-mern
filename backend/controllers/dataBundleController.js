//controllers/dataBundleController
import User from "../models/User.js";
import { zenipointGet, zenipointPost, generateReference } from "../utils/zenipoint.js";

export const buyData = async (req, res) => {
  try {
    const userId = req.user.id;
    // Accept either planId or plan_id from frontend
    const planId = req.body.planId || req.body.plan_id;
    const phone = req.body.phone || req.body.mobile_no;
    const amount = Number(req.body.amount);

    if (!planId || !phone || !amount) {
      return res.status(400).json({ success: false, msg: "Missing or invalid fields (planId, phone, amount)" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    if (user.mainBalance < amount) {
      return res.status(400).json({ success: false, msg: "Insufficient balance" });
    }

    // Deduct balance and remember we did
    user.mainBalance -= amount;
    await user.save();
    let deducted = true;

    const reference = generateReference();

    const payload = {
      mobile_no: phone,
      plan_id: String(planId),
      reference,
    };

    // Use the helper that builds auth per request
    const response = await zenipointPost("/v1/data", payload);

    const data = response.data;

    // Zenipoint success check (match docs)
    if (data && (data.status === "success" || data.code === 200)) {
      // Optionally: increment dataBundleCount, create transaction doc, etc.
      return res.status(200).json({
        success: true,
        msg: data.message || "Data purchase successful",
        reference,
        meta: data,
      });
    }

    // If we reach here Zenipoint returned a failure: refund
    if (deducted) {
      user.mainBalance += amount;
      await user.save();
    }

    return res.status(400).json({
      success: false,
      msg: data?.message || "Transaction failed",
      meta: data,
    });

  } catch (error) {
    console.log("ZENIPOINT ERROR:", error.response?.data || error.message);

    // Attempt safe refund only if deduction happened
    try {
      const user = await User.findById(req.user.id);
      if (user && req.body && req.body.amount) {
        const amt = Number(req.body.amount);
        if (!Number.isNaN(amt)) {
          user.mainBalance += amt;
          await user.save();
        }
      }
    } catch (refundErr) {
      console.error("Refund failed:", refundErr);
    }

    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
      error: error.response?.data || error.message,
    });
  }
};


export const getPlans = async (req, res) => {
  try {
    const { network, category } = req.params;
    const type = category; 

    const response = await zenipointGet(`/v1/dataplans?network=${network}&type=${type}`);
    const data = response.data;

    return res.status(200).json({
      success: true,
      plans: data?.data || [],
    });

  } catch (err) {
    console.log("PLAN ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      msg: "Failed to fetch plans from Zenipoint",
      error: err.response?.data || err.message,
    });
  }
};
