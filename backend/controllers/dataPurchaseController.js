// controllers/dataPurchaseController.js

import DataPlan from "../models/DataPlan.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";

export const buyData = async (req, res) => {
  try {
    const { plan_id, mobile_no } = req.body;

    // ============================
    //  VALIDATION
    // ============================
    if (!plan_id || !mobile_no) {
      return res.status(400).json({
        success: false,
        msg: "plan_id and mobile_no are required",
      });
    }

    // ============================
    //  FETCH PLAN FROM DATABASE
    // ============================
    const plan = await DataPlan.findOne({ plan_id });

    if (!plan) {
      return res.status(404).json({
        success: false,
        msg: "Invalid plan selected",
      });
    }

    if (!plan.zenipoint_code) {
      return res.status(400).json({
        success: false,
        msg: "This plan has no Zenipoint plan_code configured",
      });
    }

    // ============================
    //  BUILD PAYLOAD FOR ZENIPOINT
    // ============================
    const reference = generateReference();

    const payload = {
      mobile_no,
      plan_id: plan.zenipoint_code,  // <— required by Zenipoint
      reference,                     // <— must be unique
    };

    console.log("🔗 Sending to Zenipoint:", payload);

    // ============================
    //  CALL ZENIPOINT API
    // ============================
    const response = await zenipointPost("/data", payload);

    // ============================
    //  RETURN SUCCESS RESPONSE
    // ============================
    return res.json({
      success: true,
      msg: "Data purchase initiated",
      reference,
      plan: {
        plan_id: plan.plan_id,
        name: plan.name,
        amount: plan.amount,
        network: plan.network,
        category: plan.category,
      },
      zenipoint: response.data,
    });

  } catch (err) {
    console.error("❌ Zenipoint Error:", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      msg: "Data purchase failed",
      error: err.response?.data || err.message,
    });
  }
};
