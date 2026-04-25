// backend/controllers/plansController.js
import DataPlan from "../models/DataPlan.js";

const normalizeClientApp = (req) => {
  const raw = String(req.get("X-Client-App") || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("biggi-house") || raw.includes("biggihouse")) return "biggi_house";
  if (raw.includes("biggi-data") || raw.includes("biggidata")) return "biggi_data";
  return raw.replace(/[^a-z_]/g, "") || null;
};

const buildAppsOrSharedFilter = (app) => {
  if (!app) return {};
  return {
    $or: [{ apps: { $exists: false } }, { apps: { $in: [app] } }],
  };
};

/* ------------------------------------------------------
   GET all active plans (all networks)
   Example: /api/v1/plans
------------------------------------------------------- */
export const getAllPlans = async (req, res) => {
  try {
    const app = normalizeClientApp(req);
    const plans = await DataPlan.find({
      active: true,
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
      ...buildAppsOrSharedFilter(app),
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
    const app = normalizeClientApp(req);

    const plans = await DataPlan.find({
      network,
      active: true,
      // Only show plans that have a configured provider price (Zenipoint cost).
      // This prevents legacy/mock plans from leaking into the UI.
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
      ...buildAppsOrSharedFilter(app),
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
    const app = normalizeClientApp(req);

    // Normalize plan_id
    plan_id = (plan_id || "").trim().toLowerCase();

    const plan = await DataPlan.findOne({
      plan_id,
      active: true,
      provider_amount: { $ne: null },
      amount: { $gt: 0 },
      ...buildAppsOrSharedFilter(app),
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
