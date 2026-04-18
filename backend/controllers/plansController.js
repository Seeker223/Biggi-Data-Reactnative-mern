// backend/controllers/plansController.js
import DataPlan from "../models/DataPlan.js";

/* ------------------------------------------------------
   GET all active plans (all networks)
   Example: /api/v1/plans
------------------------------------------------------- */
export const getAllPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find({
      active: true,
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
    }).sort({ network: 1, amount: 1 });

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
      // Only show plans that have a configured provider price (Zenipoint cost).
      // This prevents legacy/mock plans from leaking into the UI.
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
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

    const plan = await DataPlan.findOne({
      plan_id,
      active: true,
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        msg: "Plan not available",
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
