import axios from "axios";
import PlatformLedger from "../models/PlatformLedger.js";
import ProfitSweep from "../models/ProfitSweep.js";
import ProfitSweepSettings from "../models/ProfitSweepSettings.js";

const generateSweepReference = () =>
  `BD_SWEEP_${Date.now()}_${Math.floor(Math.random() * 999999)}`;

const getSettings = async () => {
  let settings = await ProfitSweepSettings.findOne();
  const envDefaults = {
    // OPay on Flutterwave is commonly represented as bank code "099".
    // Allow override via env without hardcoding account details into the codebase.
    bankCode: String(process.env.PROFIT_SWEEP_BANK_CODE || "").trim() || undefined,
    accountNumber: String(process.env.PROFIT_SWEEP_ACCOUNT_NUMBER || "").trim() || undefined,
    accountName: String(process.env.PROFIT_SWEEP_ACCOUNT_NAME || "").trim() || undefined,
    enabled:
      process.env.PROFIT_SWEEP_ENABLED === undefined
        ? undefined
        : String(process.env.PROFIT_SWEEP_ENABLED).toLowerCase() === "true",
    minAmount:
      process.env.PROFIT_SWEEP_MIN_AMOUNT === undefined
        ? undefined
        : Number(process.env.PROFIT_SWEEP_MIN_AMOUNT),
    cron: String(process.env.PROFIT_SWEEP_CRON || "").trim() || undefined,
    timezone: String(process.env.PROFIT_SWEEP_TIMEZONE || "").trim() || undefined,
  };

  if (!settings) {
    const createPayload = {};
    for (const [k, v] of Object.entries(envDefaults)) {
      if (v !== undefined && v !== "" && !(Number.isNaN(v) && k === "minAmount")) createPayload[k] = v;
    }
    settings = await ProfitSweepSettings.create(createPayload);
    return settings;
  }

  // Backfill missing fields from env (optional).
  const patch = {};
  if (!settings.bankCode && envDefaults.bankCode) patch.bankCode = envDefaults.bankCode;
  if (!settings.accountNumber && envDefaults.accountNumber) patch.accountNumber = envDefaults.accountNumber;
  if (!settings.accountName && envDefaults.accountName) patch.accountName = envDefaults.accountName;
  if ((settings.enabled === false || settings.enabled === true) === false && envDefaults.enabled !== undefined)
    patch.enabled = envDefaults.enabled;
  if ((settings.minAmount === null || settings.minAmount === undefined) && Number.isFinite(envDefaults.minAmount))
    patch.minAmount = envDefaults.minAmount;
  if (!settings.cron && envDefaults.cron) patch.cron = envDefaults.cron;
  if (!settings.timezone && envDefaults.timezone) patch.timezone = envDefaults.timezone;
  if (Object.keys(patch).length) {
    settings = await ProfitSweepSettings.findByIdAndUpdate(settings._id, { $set: patch }, { new: true });
  }
  return settings;
};

const findUnsweptLedger = async () => {
  return PlatformLedger.find({
    type: "data_purchase",
    profit: { $gt: 0 },
    sweepStatus: "pending",
  })
    .sort({ createdAt: 1 })
    .limit(500);
};

const sumProfit = (rows) =>
  rows.reduce((sum, r) => sum + Number(r.profit || 0), 0);

export const getProfitSummary = async () => {
  const [pendingAgg, sweptAgg, totalAgg] = await Promise.all([
    PlatformLedger.aggregate([
      { $match: { type: "data_purchase", profit: { $gt: 0 }, sweepStatus: "pending" } },
      { $group: { _id: null, profit: { $sum: "$profit" }, count: { $sum: 1 } } },
    ]),
    PlatformLedger.aggregate([
      { $match: { type: "data_purchase", profit: { $gt: 0 }, sweepStatus: "swept" } },
      { $group: { _id: null, profit: { $sum: "$profit" }, count: { $sum: 1 } } },
    ]),
    PlatformLedger.aggregate([
      { $match: { type: "data_purchase", profit: { $gt: 0 } } },
      { $group: { _id: null, profit: { $sum: "$profit" }, count: { $sum: 1 } } },
    ]),
  ]);

  const pick = (a) => (Array.isArray(a) && a[0] ? a[0] : { profit: 0, count: 0 });
  return {
    pending: pick(pendingAgg),
    swept: pick(sweptAgg),
    total: pick(totalAgg),
  };
};

const flutterwaveTransfer = async ({ amount, currency, bankCode, accountNumber, narration, reference }) => {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) throw new Error("FLUTTERWAVE_SECRET_KEY not configured");

  const payload = {
    account_bank: bankCode,
    account_number: accountNumber,
    amount,
    currency,
    narration,
    reference,
  };

  const res = await axios.post("https://api.flutterwave.com/v3/transfers", payload, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });
  return res.data;
};

export const runProfitSweep = async ({ force = false } = {}) => {
  const settings = await getSettings();
  if (!settings.enabled && !force) {
    return { ok: false, skipped: true, reason: "disabled" };
  }

  if (!settings.bankCode || !settings.accountNumber) {
    return { ok: false, skipped: true, reason: "missing_destination" };
  }

  const rows = await findUnsweptLedger();
  const totalProfit = sumProfit(rows);

  if (totalProfit <= 0) {
    return { ok: false, skipped: true, reason: "no_profit" };
  }

  if (!force && totalProfit < Number(settings.minAmount || 0)) {
    return { ok: false, skipped: true, reason: "below_threshold", totalProfit };
  }

  const reference = generateSweepReference();
  const ledgerRefs = rows.map((r) => r.reference);

  // Mark ledgers as initiated so they won't be picked twice.
  await PlatformLedger.updateMany(
    { reference: { $in: ledgerRefs }, sweepStatus: "pending" },
    { $set: { sweepStatus: "initiated", sweepRef: reference } }
  );

  const sweep = await ProfitSweep.create({
    reference,
    status: "initiated",
    amount: totalProfit,
    currency: settings.currency || "NGN",
    destination: {
      bankCode: settings.bankCode,
      accountNumber: settings.accountNumber,
      accountName: settings.accountName,
    },
    ledgerRefs,
  });

  try {
    const fw = await flutterwaveTransfer({
      amount: totalProfit,
      currency: settings.currency || "NGN",
      bankCode: settings.bankCode,
      accountNumber: settings.accountNumber,
      narration: settings.narration || "BiggiData profit sweep",
      reference,
    });

    const transferData = fw?.data || {};
    sweep.flutterwaveTransferId = String(transferData.id || "");
    sweep.flutterwaveStatus = String(transferData.status || "");
    sweep.flutterwaveResponse = fw || {};
    await sweep.save();

    // Keep status as initiated until webhook confirms successful/failed.
    return {
      ok: true,
      reference,
      amount: totalProfit,
      flutterwaveTransferId: sweep.flutterwaveTransferId,
      flutterwaveStatus: sweep.flutterwaveStatus,
    };
  } catch (err) {
    // Revert ledger status so it can be retried later.
    await PlatformLedger.updateMany(
      { sweepRef: reference, sweepStatus: "initiated" },
      { $set: { sweepStatus: "pending", sweepRef: "" } }
    );
    sweep.status = "failed";
    sweep.flutterwaveStatus = "FAILED";
    sweep.flutterwaveResponse = { error: err?.response?.data || err?.message || "transfer_failed" };
    await sweep.save();
    return { ok: false, error: err?.message || "transfer_failed" };
  }
};

export const handleProfitSweepWebhook = async ({ id, status, reference, raw }) => {
  const sweep = await ProfitSweep.findOne({ reference: String(reference || "") });
  if (!sweep) return { ok: false, notFound: true };

  sweep.flutterwaveTransferId = String(id || sweep.flutterwaveTransferId || "");
  sweep.flutterwaveStatus = String(status || sweep.flutterwaveStatus || "");
  sweep.flutterwaveResponse = raw && typeof raw === "object" ? raw : sweep.flutterwaveResponse;

  if (String(status).toUpperCase() === "SUCCESSFUL") {
    sweep.status = "successful";
    await sweep.save();
    await PlatformLedger.updateMany(
      { sweepRef: sweep.reference, sweepStatus: "initiated" },
      { $set: { sweepStatus: "swept", sweptAt: new Date() } }
    );
    return { ok: true, status: "successful" };
  }

  if (String(status).toUpperCase() === "FAILED") {
    sweep.status = "failed";
    await sweep.save();
    await PlatformLedger.updateMany(
      { sweepRef: sweep.reference, sweepStatus: "initiated" },
      { $set: { sweepStatus: "failed" } }
    );
    return { ok: true, status: "failed" };
  }

  await sweep.save();
  return { ok: true, status: "updated" };
};

export const getOrCreateProfitSweepSettings = getSettings;
