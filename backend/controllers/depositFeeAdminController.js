import DepositFeeSettings from "../models/DepositFeeSettings.js";
import PlatformLedger from "../models/PlatformLedger.js";
import { getDepositFeeSettings, computeDepositFee } from "../utils/depositFee.js";

const toNumberOrFallback = (value, fallback) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clampNonNegative = (value) => Math.max(0, Number(value || 0));

export const getDepositFeeSettingsAdmin = async (req, res) => {
  try {
    const settings = await getDepositFeeSettings();
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("Get deposit fee settings admin error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch deposit fee settings" });
  }
};

export const updateDepositFeeSettings = async (req, res) => {
  try {
    const settings = await getDepositFeeSettings();
    const payload = {
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : settings.enabled,
      flatFee: clampNonNegative(toNumberOrFallback(req.body?.flatFee, settings.flatFee)),
      percentFee: clampNonNegative(toNumberOrFallback(req.body?.percentFee, settings.percentFee)),
      minFee: clampNonNegative(toNumberOrFallback(req.body?.minFee, settings.minFee ?? 0)),
      maxFee: clampNonNegative(toNumberOrFallback(req.body?.maxFee, settings.maxFee ?? 0)),
      updatedBy: req.user?.id || settings.updatedBy,
    };

    const updated = await DepositFeeSettings.findOneAndUpdate(
      {},
      { $set: payload },
      { new: true, upsert: true, sort: { updatedAt: -1, createdAt: -1 } }
    );
    return res.json({ success: true, settings: updated });
  } catch (error) {
    console.error("Update deposit fee settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to update deposit fee settings" });
  }
};

export const listDepositFeeLedger = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 20)));

    const query = { type: "deposit_fee" };
    const [rows, total] = await Promise.all([
      PlatformLedger.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      PlatformLedger.countDocuments(query),
    ]);

    return res.json({
      success: true,
      entries: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("List deposit fee ledger error:", error);
    return res.status(500).json({ success: false, message: "Failed to load deposit fee ledger" });
  }
};

export const deleteDepositFeeLedgerEntry = async (req, res) => {
  try {
    const id = String(req.params?.id || "");
    if (!id) return res.status(400).json({ success: false, message: "Ledger id required" });
    const deleted = await PlatformLedger.findOneAndDelete({ _id: id, type: "deposit_fee" });
    if (!deleted) return res.status(404).json({ success: false, message: "Ledger entry not found" });
    return res.json({ success: true, message: "Ledger entry deleted" });
  } catch (error) {
    console.error("Delete deposit fee ledger error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete ledger entry" });
  }
};

export const previewDepositFee = async (req, res) => {
  try {
    const amount = Number(req.query?.amount || 0);
    const settings = await getDepositFeeSettings();
    const fee = computeDepositFee(amount, settings);
    return res.json({ success: true, amount, fee, total: amount + fee, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to compute deposit fee" });
  }
};
