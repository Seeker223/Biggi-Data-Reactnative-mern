import DataPlan from "../models/DataPlan.js";
import { providerPlanCatalog } from "../data/providerPlanCatalog.js";

export const syncPlansFromProviderCatalog = async (req, res) => {
  try {
    const catalog = Array.isArray(providerPlanCatalog) ? providerPlanCatalog : [];
    const planIds = catalog.map((p) => String(p.plan_id || "").trim().toLowerCase()).filter(Boolean);

    if (planIds.length === 0) {
      return res.status(500).json({ success: false, msg: "Provider plan catalog is empty" });
    }

    let upserted = 0;
    for (const p of catalog) {
      const normalizedId = String(p.plan_id || "").trim().toLowerCase();
      if (!normalizedId) continue;

      await DataPlan.updateOne(
        { plan_id: normalizedId },
        {
          $set: {
            plan_id: normalizedId,
            name: p.name,
            network: String(p.network || "").toLowerCase(),
            category: String(p.category || "").trim(),
            amount: Number(p.amount),
            validity: String(p.validity || "30 days"),
            zenipoint_code: String(p.zenipoint_code || normalizedId),
            provider_amount: p.provider_amount === null || p.provider_amount === undefined ? null : Number(p.provider_amount),
            markup: p.markup === null || p.markup === undefined ? 100 : Number(p.markup),
            active: Boolean(p.active),
          },
        },
        { upsert: true }
      );
      upserted += 1;
    }

    // Disable everything not in the approved catalog.
    const disableRes = await DataPlan.updateMany(
      { plan_id: { $nin: planIds } },
      { $set: { active: false } }
    );

    return res.json({
      success: true,
      msg: "Plans synced from provider catalog",
      upserted,
      disabled: disableRes?.modifiedCount ?? 0,
      allowedPlans: planIds.length,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Failed to sync plans",
      error: err.message,
    });
  }
};

