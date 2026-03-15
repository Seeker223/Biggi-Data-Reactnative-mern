import DataPlan from "../models/DataPlan.js";
import { providerPlanCatalog } from "../data/providerPlanCatalog.js";

const normalizeId = (value) => String(value || "").trim().toLowerCase();

const toNumOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const computeAmount = ({ provider_amount, markup }) => {
  const p = toNumOrNull(provider_amount);
  const m = toNumOrNull(markup);
  if (p === null) return null;
  return p + (m === null ? 0 : m);
};

export const listAdminPlans = async (req, res) => {
  try {
    const network = normalizeId(req.query.network);
    const category = String(req.query.category || "").trim();
    const active =
      req.query.active === undefined || req.query.active === ""
        ? null
        : String(req.query.active).toLowerCase() === "true";
    const q = String(req.query.q || "").trim();

    const filter = {};
    if (network) filter.network = network;
    if (category) filter.category = category;
    if (active !== null) filter.active = active;
    if (q) {
      filter.$or = [
        { plan_id: new RegExp(q, "i") },
        { zenipoint_code: new RegExp(q, "i") },
        { name: new RegExp(q, "i") },
      ];
    }

    const plans = await DataPlan.find(filter).sort({ network: 1, category: 1, amount: 1 });
    return res.json({ success: true, count: plans.length, plans });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to load plans", error: err.message });
  }
};

export const createAdminPlan = async (req, res) => {
  try {
    const plan_id = normalizeId(req.body?.plan_id);
    const zenipoint_code = String(req.body?.zenipoint_code || "").trim();
    const name = String(req.body?.name || "").trim();
    const network = normalizeId(req.body?.network);
    const category = String(req.body?.category || "").trim();
    const validity = String(req.body?.validity || "30 days").trim();
    const provider_amount = toNumOrNull(req.body?.provider_amount);
    const markup = toNumOrNull(req.body?.markup);
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);

    if (!plan_id || !zenipoint_code || !name || !network || !category || provider_amount === null) {
      return res.status(400).json({
        success: false,
        msg: "plan_id, zenipoint_code, name, network, category and provider_amount are required",
      });
    }

    const amount = computeAmount({ provider_amount, markup: markup ?? 100 });
    if (amount === null) {
      return res.status(400).json({ success: false, msg: "Invalid provider_amount/markup" });
    }

    const exists = await DataPlan.findOne({ plan_id });
    if (exists) return res.status(409).json({ success: false, msg: "Plan already exists" });

    const plan = await DataPlan.create({
      plan_id,
      zenipoint_code,
      name,
      network,
      category,
      validity,
      provider_amount,
      markup: markup ?? 100,
      amount,
      active,
    });

    return res.status(201).json({ success: true, plan });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to create plan", error: err.message });
  }
};

export const updateAdminPlan = async (req, res) => {
  try {
    const plan_id = normalizeId(req.params.plan_id);
    if (!plan_id) return res.status(400).json({ success: false, msg: "plan_id required" });

    const existing = await DataPlan.findOne({ plan_id });
    if (!existing) return res.status(404).json({ success: false, msg: "Plan not found" });

    const patch = {};
    if (req.body?.zenipoint_code !== undefined) patch.zenipoint_code = String(req.body.zenipoint_code || "").trim();
    if (req.body?.name !== undefined) patch.name = String(req.body.name || "").trim();
    if (req.body?.network !== undefined) patch.network = normalizeId(req.body.network);
    if (req.body?.category !== undefined) patch.category = String(req.body.category || "").trim();
    if (req.body?.validity !== undefined) patch.validity = String(req.body.validity || "").trim();
    if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
    if (req.body?.provider_amount !== undefined) patch.provider_amount = toNumOrNull(req.body.provider_amount);
    if (req.body?.markup !== undefined) patch.markup = toNumOrNull(req.body.markup);

    if (patch.provider_amount === null && req.body?.provider_amount !== undefined) {
      return res.status(400).json({ success: false, msg: "Invalid provider_amount" });
    }
    if (patch.markup === null && req.body?.markup !== undefined) {
      return res.status(400).json({ success: false, msg: "Invalid markup" });
    }

    const provider_amount = patch.provider_amount !== undefined ? patch.provider_amount : existing.provider_amount;
    const markup = patch.markup !== undefined ? patch.markup : existing.markup ?? 100;
    const amount = computeAmount({ provider_amount, markup });
    if (amount === null) {
      return res.status(400).json({ success: false, msg: "provider_amount is required to compute price" });
    }
    patch.amount = amount;

    const updated = await DataPlan.findOneAndUpdate({ plan_id }, { $set: patch }, { new: true });
    return res.json({ success: true, plan: updated });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to update plan", error: err.message });
  }
};

export const deactivateAdminPlan = async (req, res) => {
  try {
    const plan_id = normalizeId(req.params.plan_id);
    if (!plan_id) return res.status(400).json({ success: false, msg: "plan_id required" });

    const plan = await DataPlan.findOneAndUpdate(
      { plan_id },
      { $set: { active: false } },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, msg: "Plan not found" });
    return res.json({ success: true, plan });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to deactivate plan", error: err.message });
  }
};

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
