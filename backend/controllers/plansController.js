// backend/controllers/plansController.js
import DataPlan from "../models/DataPlan.js";

/* ------------------------------------------------------
   GET all plans for a specific network
   Example: /api/v1/plans/network/mtn
------------------------------------------------------- */
export const getNetworkPlans = async (req, res) => {
  try {
    let { network } = req.params;

    network = (network || "").trim().toLowerCase();

    const plans = await DataPlan.find({
      network,
      active: true,
    }).sort({ amount: 1 });

    return res.json({
      success: true,
      count: plans.length,
      plans,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Failed to fetch plans",
      error: err.message,
    });
  }
};

/* ------------------------------------------------------
   GET single plan by plan_id
   Example: /api/v1/plans/single/mtn_sme_1gb
------------------------------------------------------- */
export const getPlanById = async (req, res) => {
  try {
    let { plan_id } = req.params;

    // Normalize plan_id
    plan_id = (plan_id || "").trim().toLowerCase();

    const plan = await DataPlan.findOne({ plan_id });

    if (!plan) {
      return res.status(404).json({
        success: false,
        msg: "Plan not found",
      });
    }

    return res.json({
      success: true,
      plan,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Failed to fetch plan",
      error: err.message,
    });
  }
};
