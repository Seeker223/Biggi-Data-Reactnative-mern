// backend/controllers/plansController.js
import DataPlan from "../models/DataPlan.js";

// GET all plans within network (mtn, glo, airtel, etc)
export const getNetworkPlans = async (req, res) => {
  try {
    const { network } = req.params;
    const plans = await DataPlan.find({ network, active: true }).sort({
      amount: 1,
    });

    return res.json({ success: true, count: plans.length, plans });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Failed to fetch plans",
      error: err.message,
    });
  }
};

// GET single plan details
export const getPlanById = async (req, res) => {
  try {
    const { plan_id } = req.params;

    const plan = await DataPlan.findOne({ plan_id });
    if (!plan) {
      return res.status(404).json({ success: false, msg: "Plan not found" });
    }

    return res.json({ success: true, plan });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Failed to fetch plan",
      error: err.message,
    });
  }
};