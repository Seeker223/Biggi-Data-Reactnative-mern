import ProfitSweep from "../models/ProfitSweep.js";
import ProfitSweepSettings from "../models/ProfitSweepSettings.js";
import {
  getOrCreateProfitSweepSettings,
  getProfitSummary,
  runProfitSweep,
} from "../utils/profitSweep.js";

export const getProfitSweepSettings = async (req, res) => {
  try {
    const settings = await getOrCreateProfitSweepSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to load settings", error: err.message });
  }
};

export const updateProfitSweepSettings = async (req, res) => {
  try {
    const settings = await getOrCreateProfitSweepSettings();
    const patch = {};
    for (const k of ["enabled", "minAmount", "currency", "bankCode", "accountNumber", "accountName", "cron", "timezone", "narration"]) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }
    const updated = await ProfitSweepSettings.findByIdAndUpdate(settings._id, { $set: patch }, { new: true });
    return res.json({ success: true, settings: updated });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to update settings", error: err.message });
  }
};

export const getProfitSummaryAdmin = async (req, res) => {
  try {
    const summary = await getProfitSummary();
    return res.json({ success: true, summary });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to load profit summary", error: err.message });
  }
};

export const listProfitSweeps = async (req, res) => {
  try {
    const sweeps = await ProfitSweep.find().sort({ createdAt: -1 }).limit(50);
    return res.json({ success: true, count: sweeps.length, sweeps });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Failed to load sweeps", error: err.message });
  }
};

export const runProfitSweepNow = async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    const result = await runProfitSweep({ force });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Sweep failed", error: err.message });
  }
};

