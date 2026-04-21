import axios from "axios";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import BiggiHouseWallet from "../models/BiggiHouseWallet.js";
import BiggiHouseHouse from "../models/BiggiHouseHouse.js";
import BiggiHouseMembership from "../models/BiggiHouseMembership.js";
import BiggiHouseWinner from "../models/BiggiHouseWinner.js";
import BiggiHouseConfig from "../models/BiggiHouseConfig.js";
import BiggiHouseWeeklyCardState from "../models/BiggiHouseWeeklyCardState.js";
import BiggiHouseWeeklyCardPlay from "../models/BiggiHouseWeeklyCardPlay.js";
import Subscription from "../models/Subscription.js";
import { ensureBiggiHouseSeed } from "../utils/biggiHouseSeed.js";
import { computeDepositFee } from "../utils/depositFee.js";

const txStatusAllowed = ["success", "success_price_mismatch", "simulated"];

const BIGGI_HOUSE_DEFAULT_CONFIG = {
  weeklyPayout: { dayOfWeek: 0, hour: 22, minute: 0 }, // Sunday 10pm
  features: { weeklyCardGameEnabled: false },
  game: { requireWeeklyDataPurchase: true },
};

const ensureBiggiHouseConfig = async () => {
  const existing = await BiggiHouseConfig.findOne({ singleton: true });
  if (existing) return existing;
  return BiggiHouseConfig.create({ singleton: true, ...BIGGI_HOUSE_DEFAULT_CONFIG });
};

const toConfigDTO = (cfg) => ({
  weeklyPayout: cfg.weeklyPayout || BIGGI_HOUSE_DEFAULT_CONFIG.weeklyPayout,
  features: {
    ...(BIGGI_HOUSE_DEFAULT_CONFIG.features || {}),
    ...(cfg.features || {}),
  },
  game: {
    ...(BIGGI_HOUSE_DEFAULT_CONFIG.game || {}),
    ...(cfg.game || {}),
  },
  updatedAt: cfg.updatedAt,
});

const getWeeklyWindowStart = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return start;
};

const normalizePhone = (value) => String(value || "").replace(/\s+/g, "").trim();

const splitName = (fullName = "") => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "Biggi", last: "House" };
  if (parts.length === 1) return { first: parts[0], last: "User" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

// BiggiHouse deposits have an app-specific fee (independent from Biggi Data).
const getBiggiHouseFeeSettings = () => ({
  enabled: true,
  flatFee: 0,
  percentFee: 2,
  minFee: 0,
  maxFee: 0,
});

const ensureWallet = async (userId) => {
  const wallet = await BiggiHouseWallet.findOne({ userId });
  if (wallet) return wallet;
  return BiggiHouseWallet.create({ userId, balance: 0, currency: "NGN" });
};

const isStaticVirtualAccountEnabled = () =>
  ["1", "true", "yes"].includes(
    String(process.env.ENABLE_STATIC_VIRTUAL_ACCOUNTS || "").toLowerCase()
  );

const getWeeklyBiggiHouseDataPurchaseStatsByPhone = async (phoneNumber) => {
  const windowStart = getWeeklyWindowStart();

  const rows = await Wallet.aggregate([
    { $match: { type: "main" } },
    { $unwind: "$transactions" },
    {
      $match: {
        "transactions.type": "purchase",
        "transactions.status": { $in: txStatusAllowed },
        "transactions.date": { $gte: windowStart },
        "transactions.meta.action": "data_purchase",
        "transactions.meta.mobile_no": phoneNumber,
        "transactions.meta.app": "biggi_house", // Only count Biggi House purchases
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        lastPurchaseAt: { $max: "$transactions.date" },
      },
    },
  ]);

  const row = rows && rows[0] ? rows[0] : null;
  return {
    windowStart,
    count: Number(row?.count || 0),
    lastPurchaseAt: row?.lastPurchaseAt || null,
  };
};

const formatBiggiHouse = (house, memberCount = 0) => {
  const members = Number(memberCount || 0);
  const minimum = Number(house.minimum || 0);
  return {
    id: String(house._id),
    number: house.number,
    minimum,
    members,
    maxUsers: null,
    totalPool: members * minimum,
    status: members > 0 ? "In Progress" : "Open",
  };
};

export const getBiggiHouseConfig = async (_req, res) => {
  const cfg = await ensureBiggiHouseConfig();
  res.json({ success: true, config: toConfigDTO(cfg) });
};

export const adminUpdateBiggiHouseConfig = async (req, res) => {
  const cfg = await ensureBiggiHouseConfig();

  const nextWeeklyPayout = req.body?.weeklyPayout;
  if (nextWeeklyPayout && typeof nextWeeklyPayout === "object") {
    const dayOfWeek = Number(nextWeeklyPayout.dayOfWeek);
    const hour = Number(nextWeeklyPayout.hour);
    const minute = Number(nextWeeklyPayout.minute);
    cfg.weeklyPayout = {
      dayOfWeek: Number.isFinite(dayOfWeek) ? Math.max(0, Math.min(6, Math.trunc(dayOfWeek))) : 0,
      hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.trunc(hour))) : 22,
      minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.trunc(minute))) : 0,
    };
  }

  const nextFeatures = req.body?.features;
  if (nextFeatures && typeof nextFeatures === "object") {
    if (typeof nextFeatures.weeklyCardGameEnabled === "boolean") {
      cfg.features = {
        ...(cfg.features || {}),
        weeklyCardGameEnabled: nextFeatures.weeklyCardGameEnabled,
      };
    }
    if (typeof nextFeatures.monthlyCardGameEnabled === "boolean") {
      cfg.features = {
        ...(cfg.features || {}),
        monthlyCardGameEnabled: nextFeatures.monthlyCardGameEnabled,
      };
    }
  }

  const nextGame = req.body?.game;
  if (nextGame && typeof nextGame === "object") {
    if (typeof nextGame.requireWeeklyDataPurchase === "boolean") {
      cfg.game = {
        ...(cfg.game || {}),
        requireWeeklyDataPurchase: nextGame.requireWeeklyDataPurchase,
      };
    }
    if (typeof nextGame.requireDataPurchase === "boolean") {
      cfg.game = {
        ...(cfg.game || {}),
        requireDataPurchase: nextGame.requireDataPurchase,
      };
    }
  }

  await cfg.save();
  res.json({ success: true, config: toConfigDTO(cfg) });
};

const normalizeWeeklyPicks = (letters) => {
  if (!Array.isArray(letters)) return null;
  const clean = letters
    .map((l) => String(l || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 3);
  if (clean.length !== 3) return null;
  const ok = clean.every((l) => /^[A-Z]$/.test(l));
  if (!ok) return null;
  return clean;
};

const getWeekKey = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    );
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const nextSundayAt = (hour = 22, minute = 0) => {
  const now = new Date();
  const next = new Date(now);
  const day = next.getDay(); // 0=Sun
  let addDays = (7 - day) % 7;
  if (
    addDays === 0 &&
    (next.getHours() > hour || (next.getHours() === hour && next.getMinutes() >= minute))
  ) {
    addDays = 7;
  }
  next.setDate(next.getDate() + addDays);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const randomLetters = (count) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
  }
  return out;
};

const ensureWeeklyCardState = async () => {
  const cfg = await ensureBiggiHouseConfig();
  const payout = cfg.weeklyPayout || BIGGI_HOUSE_DEFAULT_CONFIG.weeklyPayout;
  const revealAt = nextSundayAt(Number(payout.hour || 22), Number(payout.minute || 0));
  const weekKey = getWeekKey(revealAt);

  const existing = await BiggiHouseWeeklyCardState.findOne({ weekKey });
  if (existing) return { cfg, card: existing };

  const letters = randomLetters(9);
  const winningGroupIndex = Math.floor(Math.random() * 3);
  const created = await BiggiHouseWeeklyCardState.create({
    weekKey,
    letters,
    winningGroupIndex,
    revealAt,
  });
  return { cfg, card: created };
};

export const getBiggiHouseWeeklyCard = async (_req, res) => {
  const { card } = await ensureWeeklyCardState();
  const revealReady = new Date() >= new Date(card.revealAt);

  res.json({
    success: true,
    card: {
      weekKey: card.weekKey,
      letters: card.letters || [],
      revealAt: card.revealAt,
      revealReady,
      winningGroupIndex: revealReady ? card.winningGroupIndex : null,
    },
  });
};

export const playBiggiHouseWeeklyCardGame = async (req, res) => {
  const { cfg, card } = await ensureWeeklyCardState();
  const enabled =
    Boolean(cfg?.features?.weeklyCardGameEnabled) ||
    Boolean(cfg?.features?.monthlyCardGameEnabled);
  if (!enabled) {
    return res.status(403).json({
      success: false,
      error: "Game is currently disabled.",
      errorCode: "GAME_DISABLED",
    });
  }

  const letters = normalizeWeeklyPicks(req.body?.letters);
  if (!letters) {
    return res.status(400).json({
      success: false,
      error: "Enter exactly 3 letters (A-Z).",
      errorCode: "INVALID_PICKS",
    });
  }

  const requireWeekly =
    typeof cfg?.game?.requireWeeklyDataPurchase === "boolean"
      ? cfg.game.requireWeeklyDataPurchase
      : Boolean(cfg?.game?.requireDataPurchase);

  if (requireWeekly) {
    const me = await User.findById(req.user.id).select("phoneNumber");
    const phoneNumber = normalizePhone(me?.phoneNumber);
    if (!phoneNumber) {
      return res.status(403).json({
        success: false,
        error: "Phone number is required to validate data purchases.",
        errorCode: "MISSING_PHONE_NUMBER",
      });
    }

    const stats = await getWeeklyBiggiHouseDataPurchaseStatsByPhone(phoneNumber);
    if (Number(stats.count || 0) < 1) {
      return res.status(403).json({
        success: false,
        error: "You must purchase at least 1 data bundle this week before you can play.",
        errorCode: "DATA_PURCHASE_REQUIRED",
      });
    }
  }

  const play = await BiggiHouseWeeklyCardPlay.create({
    userId: req.user.id,
    weekKey: card.weekKey,
    letters,
  });

  res.json({
    success: true,
    play: {
      id: String(play._id),
      weekKey: play.weekKey,
      letters: play.letters,
      createdAt: play.createdAt,
    },
  });
};

const sortLetters = (arr) => (Array.isArray(arr) ? [...arr].sort() : []);

export const getBiggiHouseWeeklyCardHistory = async (req, res) => {
  const { card } = await ensureWeeklyCardState();
  const revealReady = new Date() >= new Date(card.revealAt);
  const winningGroupIndex = revealReady ? card.winningGroupIndex : null;
  const winningLetters =
    revealReady && Number.isInteger(winningGroupIndex)
      ? (card.letters || []).slice(winningGroupIndex * 3, winningGroupIndex * 3 + 3)
      : null;

  const plays = await BiggiHouseWeeklyCardPlay.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(30);

  res.json({
    success: true,
    plays: plays.map((p) => {
      const matched =
        revealReady && winningLetters
          ? JSON.stringify(sortLetters(p.letters)) === JSON.stringify(sortLetters(winningLetters))
          : undefined;
      return {
        id: String(p._id),
        weekKey: p.weekKey,
        letters: p.letters || [],
        createdAt: p.createdAt,
        matched,
      };
    }),
  });
};

// Backward-compat exports (old names used by earlier UI)
export const playBiggiHouseMonthlyCardGame = playBiggiHouseWeeklyCardGame;
export const getBiggiHouseMonthlyCardHistory = getBiggiHouseWeeklyCardHistory;

export const getBiggiHouseHouses = async (req, res) => {
  await ensureBiggiHouseSeed();
  const houses = await BiggiHouseHouse.find({ active: true }).sort({ number: 1 });

  const memberCounts = await BiggiHouseMembership.aggregate([
    { $group: { _id: "$houseId", members: { $sum: 1 } } },
  ]);
  const countMap = new Map(memberCounts.map((row) => [String(row._id), row.members]));

  res.json({
    success: true,
    houses: houses.map((house) => formatBiggiHouse(house, countMap.get(String(house._id)) || 0)),
  });
};

export const getBiggiHouseMemberships = async (req, res) => {
  const memberships = await BiggiHouseMembership.find({ userId: req.user.id })
    .populate("houseId")
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    memberships: memberships
      .filter((m) => m.houseId)
      .map((m) => ({
        id: String(m._id),
        joinedAt: m.joinedAt,
        house: {
          id: String(m.houseId._id),
          number: m.houseId.number,
          minimum: m.houseId.minimum,
        },
      })),
  });
};

export const generateBiggiHouseTxRef = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  const base = `bh_${userId}_${Date.now()}`;
  const random = Math.floor(Math.random() * 1000);
  return res.json({
    success: true,
    tx_ref: `${base}${random ? `_${random}` : ""}`,
  });
};

export const getBiggiHouseDepositFeeSettings = async (req, res) => {
  return res.json({ success: true, settings: getBiggiHouseFeeSettings() });
};

export const getBiggiHouseVirtualAccount = async (req, res) => {
  try {
    if (!isStaticVirtualAccountEnabled()) {
      return res.status(200).json({
        success: false,
        mode: "dynamic",
        disabled: true,
        message: "Static virtual accounts are disabled. Use dynamic checkout.",
      });
    }

    const user = await User.findById(req.user.id).select(
      "email username phoneNumber nin biggiHouseVirtualAccount"
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const forceRefresh = String(req.query.refresh || "").toLowerCase() === "true";
    const existing = user.biggiHouseVirtualAccount || {};
    if (!forceRefresh && existing?.accountNumber) {
      return res.json({
        success: true,
        mode: "static",
        account: {
          accountNumber: existing.accountNumber,
          bankName: existing.bankName,
          accountName: existing.accountName,
          reference: existing.reference || "",
          updatedAt: existing.updatedAt || existing.createdAt || null,
        },
      });
    }

    if (!process.env.FLUTTERWAVE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message: "Flutterwave secret key not configured",
      });
    }

    if (!user.nin) {
      return res.status(400).json({
        success: false,
        message: "NIN is required to create a static virtual account.",
      });
    }

    const { first, last } = splitName(user.username || user.email);
    const txRef = `bhva_${user._id}_${Date.now()}`;
    const payload = {
      email: user.email,
      tx_ref: txRef,
      phonenumber: user.phoneNumber || undefined,
      is_permanent: true,
      firstname: first,
      lastname: last,
      narration: `Biggi House ${user.username || user.email}`,
      nin: user.nin || undefined,
    };

    const response = await axios.post(
      "https://api.flutterwave.com/v3/virtual-account-numbers",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    if (response.data?.status !== "success") {
      return res.status(500).json({
        success: false,
        message: response.data?.message || "Virtual account creation failed",
        error: response.data,
      });
    }

    const data = response.data?.data || {};
    const account = {
      accountNumber: data.account_number || "",
      bankName: data.bank_name || "",
      accountName: data.account_name || `${first} ${last}`.trim(),
      reference: data.order_ref || txRef,
      updatedAt: new Date().toISOString(),
    };

    user.biggiHouseVirtualAccount = {
      provider: "flutterwave",
      accountNumber: account.accountNumber,
      bankName: account.bankName,
      accountName: account.accountName,
      reference: account.reference,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
      meta: data,
    };
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, mode: "static", account });
  } catch (error) {
    console.error(
      "BiggiHouse get virtual account error:",
      error?.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message: "Failed to load virtual account",
      error: error?.response?.data || error.message,
    });
  }
};

export const verifyBiggiHouseFlutterwavePayment = async (req, res) => {
  let tx_ref;
  try {
    tx_ref = String(req.body?.tx_ref || "").trim();
    const requestedAmount = Number(req.body?.amount || 0);

    if (!tx_ref) return res.status(400).json({ success: false, message: "tx_ref required" });
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const payment = response.data?.data;
    if (!payment) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    if (String(payment.status || "").toLowerCase() !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    const paidAmount = Number(payment.amount || 0);
    const serviceCharge = computeDepositFee(requestedAmount, getBiggiHouseFeeSettings());
    const expectedTotal = Number(requestedAmount) + Number(serviceCharge || 0);
    if (Math.round(paidAmount) !== Math.round(expectedTotal)) {
      return res.status(400).json({
        success: false,
        message: "Payment amount does not match expected total",
        expectedTotal,
        paidAmount,
      });
    }

    const wallet = await ensureWallet(req.user.id);
    const exists = (wallet.transactions || []).find((t) => t.reference === tx_ref);
    if (exists) {
      return res.json({
        success: true,
        message: "Payment already processed",
        balance: wallet.balance,
      });
    }

    const previousBalance = Number(wallet.balance || 0);
    wallet.balance = previousBalance + Number(requestedAmount);
    wallet.lastUpdated = new Date();
    wallet.transactions.unshift({
      type: "deposit",
      amount: Number(requestedAmount),
      status: "completed",
      reference: tx_ref,
      meta: {
        action: "biggihouse_deposit",
        channel: "flutterwave",
        serviceCharge,
        totalPaid: paidAmount,
        previousBalance,
        newBalance: wallet.balance,
      },
    });
    wallet.transactions = (wallet.transactions || []).slice(0, 100);
    await wallet.save();

    return res.json({
      success: true,
      message: "Deposit credited to BiggiHouse wallet",
      balance: wallet.balance,
      serviceCharge,
      totalPaid: paidAmount,
    });
  } catch (error) {
    console.error(
      "BiggiHouse verify flutterwave error:",
      tx_ref,
      error?.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error?.response?.data || error.message,
    });
  }
};

export const getBiggiHouseWallet = async (req, res) => {
  const wallet = await ensureWallet(req.user.id);
  res.json({
    success: true,
    wallet: {
      balance: wallet.balance,
      currency: wallet.currency,
      lastUpdated: wallet.lastUpdated,
      transactions: (wallet.transactions || []).slice(0, 20),
    },
  });
};

export const depositBiggiHouseWallet = async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount" });
  }

  const wallet = await ensureWallet(req.user.id);
  const previousBalance = Number(wallet.balance || 0);
  wallet.balance = previousBalance + amount;
  wallet.lastUpdated = new Date();
  wallet.transactions.unshift({
    type: "deposit",
    amount,
    status: "completed",
    reference: `bh_dep_${Date.now()}`,
    meta: { previousBalance, newBalance: wallet.balance },
  });
  wallet.transactions = wallet.transactions.slice(0, 100);
  await wallet.save();

  res.json({ success: true, balance: wallet.balance });
};

export const withdrawBiggiHouseWallet = async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount" });
  }

  const wallet = await ensureWallet(req.user.id);
  const previousBalance = Number(wallet.balance || 0);
  if (previousBalance < amount) {
    return res.status(400).json({ success: false, error: "Insufficient balance" });
  }

  wallet.balance = previousBalance - amount;
  wallet.lastUpdated = new Date();
  wallet.transactions.unshift({
    type: "withdraw",
    amount,
    status: "completed",
    reference: `bh_wd_${Date.now()}`,
    meta: { previousBalance, newBalance: wallet.balance },
  });
  wallet.transactions = wallet.transactions.slice(0, 100);
  await wallet.save();

  res.json({ success: true, balance: wallet.balance });
};

export const getBiggiHouseEligibility = async (req, res) => {
  const me = await User.findById(req.user.id).select("phoneNumber");
  const phoneNumber = normalizePhone(me?.phoneNumber);
  if (!phoneNumber) {
    return res.json({
      success: true,
      eligible: false,
      reason: "MISSING_PHONE_NUMBER",
    });
  }

  const stats = await getWeeklyBiggiHouseDataPurchaseStatsByPhone(phoneNumber);

  res.json({
    success: true,
    eligible: stats.count > 0,
    reason: stats.count > 0 ? "OK" : "NO_PURCHASE_THIS_WEEK",
    phoneNumber,
    windowStart: stats.windowStart,
    purchasesThisWeek: stats.count,
    lastPurchaseAt: stats.lastPurchaseAt,
  });
};

export const joinBiggiHouse = async (req, res) => {
  await ensureBiggiHouseSeed();

  const houseId = String(req.params.id || "").trim();
  const house = await BiggiHouseHouse.findById(houseId);
  if (!house || !house.active) {
    return res.status(404).json({ success: false, error: "House not found" });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: "User not found" });
  }

  const phoneNumber = normalizePhone(user?.phoneNumber);
  if (!phoneNumber) {
    return res.status(403).json({
      success: false,
      error: "You must add a phone number to your profile before joining a house.",
      errorCode: "MISSING_PHONE_NUMBER",
    });
  }

  // Joining a house requires an active BiggiHouse subscription.
  // (Weekly data purchase eligibility was removed.)
  if (!user.subscription) {
    return res.status(403).json({
      success: false,
      error: "Active subscription required to join a house.",
      errorCode: "SUBSCRIPTION_REQUIRED",
    });
  }

  const subscription = await Subscription.findById(user.subscription);
  const subscriptionActive =
    Boolean(subscription?.isActive) &&
    subscription?.renewalDate &&
    new Date(subscription.renewalDate) > new Date();
  if (!subscriptionActive) {
    return res.status(403).json({
      success: false,
      error: "Active subscription required to join a house.",
      errorCode: "SUBSCRIPTION_REQUIRED",
    });
  }

  const wallet = await ensureWallet(req.user.id);
  const amount = Number(house.minimum || 0);
  if (Number(wallet.balance || 0) < amount) {
    return res.status(400).json({ success: false, error: "Insufficient BiggiHouse wallet balance" });
  }

  const existing = await BiggiHouseMembership.findOne({ userId: req.user.id, houseId: house._id });
  if (existing) {
    return res.status(400).json({ success: false, error: "You have already joined this house." });
  }

  const previousBalance = Number(wallet.balance || 0);
  wallet.balance = previousBalance - amount;
  wallet.lastUpdated = new Date();
  wallet.transactions.unshift({
    type: "house_join",
    amount,
    status: "completed",
    reference: `bh_join_${house.number}_${Date.now()}`,
    meta: {
      houseId: String(house._id),
      houseNumber: house.number,
      previousBalance,
      newBalance: wallet.balance,
    },
  });
  wallet.transactions = wallet.transactions.slice(0, 100);
  await wallet.save();

  await BiggiHouseMembership.create({
    userId: req.user.id,
    houseId: house._id,
    joinedAt: new Date(),
    lastPaidAt: new Date(),
  });

  const memberCount = await BiggiHouseMembership.countDocuments({ houseId: house._id });

  res.json({
    success: true,
    house: formatBiggiHouse(house, memberCount),
    wallet: { balance: wallet.balance, currency: wallet.currency },
  });
};

// -------------------------
// Admin C-Panel Endpoints
// -------------------------

const asInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

export const adminOverview = async (req, res) => {
  await ensureBiggiHouseSeed();

  const [totalUsers, verifiedUsers, totalMerchants] = await Promise.all([
    User.countDocuments({ allowedApps: "biggi_house" }),
    User.countDocuments({ allowedApps: "biggi_house", isVerified: true }),
    User.countDocuments({ allowedApps: "biggi_house", userRole: "merchant" }),
  ]);

  const [totalHouses, activeHouses, totalMemberships] = await Promise.all([
    BiggiHouseHouse.countDocuments({}),
    BiggiHouseHouse.countDocuments({ active: true }),
    BiggiHouseMembership.countDocuments({}),
  ]);

  const totalWalletBalanceAgg = await BiggiHouseWallet.aggregate([
    { $group: { _id: null, total: { $sum: "$balance" } } },
  ]);
  const totalWalletBalance = Number(totalWalletBalanceAgg?.[0]?.total || 0);

  res.json({
    success: true,
    overview: {
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        merchants: totalMerchants,
      },
      houses: {
        total: totalHouses,
        active: activeHouses,
        memberships: totalMemberships,
      },
      wallet: { totalBalance: totalWalletBalance, currency: "NGN" },
    },
  });
};

export const adminListUsers = async (req, res) => {
  const q = String(req.query.q || "").trim();
  const page = Math.max(1, asInt(req.query.page, 1));
  const limit = Math.min(50, Math.max(5, asInt(req.query.limit, 20)));
  const skip = (page - 1) * limit;

  const query = { allowedApps: "biggi_house" };
  if (q) {
    query.$or = [
      { username: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
      { phoneNumber: { $regex: q, $options: "i" } },
    ];
  }

  const [rows, total] = await Promise.all([
    User.find(query)
      .select(
        "_id username email phoneNumber role userRole isVerified allowedApps subscription createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(query),
  ]);

  const userIds = rows.map((u) => u._id);

  const wallets = await BiggiHouseWallet.find({ userId: { $in: userIds } }).select(
    "userId balance currency"
  );
  const walletMap = new Map(wallets.map((w) => [String(w.userId), w]));

  const subscriptionIds = rows
    .map((u) => u.subscription)
    .filter(Boolean)
    .map((id) => String(id));
  const subscriptions = subscriptionIds.length
    ? await Subscription.find({ _id: { $in: subscriptionIds } }).select(
        "_id isActive startDate renewalDate autoRenew"
      )
    : [];
  const subscriptionMap = new Map(subscriptions.map((s) => [String(s._id), s]));
  const now = new Date();

  res.json({
    success: true,
    page,
    limit,
    total,
    users: rows.map((u) => ({
      ...(() => {
        const wallet = walletMap.get(String(u._id));
        const sub = u.subscription ? subscriptionMap.get(String(u.subscription)) : null;
        const active = Boolean(sub?.isActive) && sub?.renewalDate && new Date(sub.renewalDate) > now;
        return {
          walletBalance: Number(wallet?.balance || 0),
          walletCurrency: wallet?.currency || "NGN",
          subscription: sub
            ? {
                id: String(sub._id),
                active,
                startDate: sub.startDate || null,
                renewalDate: sub.renewalDate || null,
                autoRenew: Boolean(sub.autoRenew),
              }
            : { active: false },
        };
      })(),
      id: String(u._id),
      username: u.username,
      email: u.email,
      phoneNumber: u.phoneNumber || "",
      role: u.role,
      userRole: u.userRole,
      isVerified: Boolean(u.isVerified),
      allowedApps: u.allowedApps || [],
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    })),
  });
};

export const adminUpdateUser = async (req, res) => {
  const userId = String(req.params.id || "").trim();
  if (!userId) return res.status(400).json({ success: false, error: "Invalid user id" });

  const patch = {};
  if (typeof req.body?.phoneNumber === "string") {
    patch.phoneNumber = normalizePhone(req.body.phoneNumber) || undefined;
  }
  if (typeof req.body?.isVerified === "boolean") {
    patch.isVerified = req.body.isVerified;
    patch.verifiedAt = req.body.isVerified ? new Date() : null;
  }
  if (typeof req.body?.userRole === "string") {
    const ur = String(req.body.userRole).toLowerCase();
    patch.userRole = ur === "merchant" ? "merchant" : "private";
  }
  if (Array.isArray(req.body?.allowedApps)) {
    const next = req.body.allowedApps.map((v) => String(v)).filter(Boolean);
    // Keep BiggiHouse access unless admin explicitly removes it.
    patch.allowedApps = next;
  }

  const updated = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true }).select(
    "_id username email phoneNumber role userRole isVerified allowedApps createdAt updatedAt"
  );
  if (!updated) return res.status(404).json({ success: false, error: "User not found" });

  res.json({
    success: true,
    user: {
      id: String(updated._id),
      username: updated.username,
      email: updated.email,
      phoneNumber: updated.phoneNumber || "",
      role: updated.role,
      userRole: updated.userRole,
      isVerified: Boolean(updated.isVerified),
      allowedApps: updated.allowedApps || [],
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
};

export const adminAdjustBiggiHouseUserWallet = async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const amount = Number(req.body?.amount || 0);
  if (!userId) return res.status(400).json({ success: false, error: "Invalid user id" });
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ success: false, error: "amount is required" });
  }

  const wallet = await ensureWallet(userId);
  const previousBalance = Number(wallet.balance || 0);
  const nextBalance = previousBalance + amount;
  if (nextBalance < 0) {
    return res.status(400).json({ success: false, error: "Insufficient balance" });
  }

  wallet.balance = nextBalance;
  wallet.lastUpdated = new Date();
  wallet.transactions.unshift({
    type: "admin_adjust",
    amount,
    status: "completed",
    reference: `bh_admin_adj_${Date.now()}`,
    meta: {
      previousBalance,
      newBalance: wallet.balance,
      adminUserId: req.user?.id || req.user?._id,
    },
  });
  wallet.transactions = (wallet.transactions || []).slice(0, 100);
  await wallet.save();

  res.json({
    success: true,
    wallet: { balance: wallet.balance, currency: wallet.currency, lastUpdated: wallet.lastUpdated },
  });
};

export const adminListHouses = async (req, res) => {
  await ensureBiggiHouseSeed();
  const houses = await BiggiHouseHouse.find({}).sort({ number: 1 });
  const memberCounts = await BiggiHouseMembership.aggregate([
    { $group: { _id: "$houseId", members: { $sum: 1 } } },
  ]);
  const countMap = new Map(memberCounts.map((row) => [String(row._id), row.members]));

  res.json({
    success: true,
    houses: houses.map((h) => ({
      id: String(h._id),
      number: h.number,
      minimum: h.minimum,
      active: Boolean(h.active),
      members: Number(countMap.get(String(h._id)) || 0),
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    })),
  });
};

export const adminCreateHouse = async (req, res) => {
  const number = asInt(req.body?.number, null);
  const minimum = asInt(req.body?.minimum, null);
  const active =
    typeof req.body?.active === "boolean" ? Boolean(req.body.active) : true;

  if (!Number.isFinite(number) || number < 1 || number > 10) {
    return res.status(400).json({ success: false, error: "number must be 1..10" });
  }
  if (!Number.isFinite(minimum) || minimum < 0) {
    return res.status(400).json({ success: false, error: "minimum must be >= 0" });
  }

  try {
    const created = await BiggiHouseHouse.create({ number, minimum, active });
    return res.status(201).json({
      success: true,
      house: {
        id: String(created._id),
        number: created.number,
        minimum: created.minimum,
        active: Boolean(created.active),
      },
    });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, error: err?.message || "Unable to create house" });
  }
};

export const adminUpdateHouse = async (req, res) => {
  const houseId = String(req.params.id || "").trim();
  if (!houseId) return res.status(400).json({ success: false, error: "Invalid house id" });

  const patch = {};
  if (Number.isFinite(Number(req.body?.number))) patch.number = asInt(req.body.number, null);
  if (Number.isFinite(Number(req.body?.minimum))) patch.minimum = asInt(req.body.minimum, null);
  if (typeof req.body?.active === "boolean") patch.active = Boolean(req.body.active);

  try {
    const updated = await BiggiHouseHouse.findByIdAndUpdate(houseId, { $set: patch }, { new: true });
    if (!updated) return res.status(404).json({ success: false, error: "House not found" });
    return res.json({
      success: true,
      house: {
        id: String(updated._id),
        number: updated.number,
        minimum: updated.minimum,
        active: Boolean(updated.active),
      },
    });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, error: err?.message || "Unable to update house" });
  }
};

export const adminDeleteHouse = async (req, res) => {
  const houseId = String(req.params.id || "").trim();
  if (!houseId) return res.status(400).json({ success: false, error: "Invalid house id" });

  const membershipCount = await BiggiHouseMembership.countDocuments({ houseId });
  if (membershipCount > 0) {
    const updated = await BiggiHouseHouse.findByIdAndUpdate(
      houseId,
      { $set: { active: false } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, error: "House not found" });
    return res.json({
      success: true,
      message: "House has members; deactivated instead of deleting.",
      house: { id: String(updated._id), active: Boolean(updated.active) },
    });
  }

  const deleted = await BiggiHouseHouse.findByIdAndDelete(houseId);
  if (!deleted) return res.status(404).json({ success: false, error: "House not found" });
  return res.json({ success: true, message: "House deleted" });
};

export const adminListMemberships = async (req, res) => {
  const houseId = String(req.query.houseId || "").trim();
  const page = Math.max(1, asInt(req.query.page, 1));
  const limit = Math.min(50, Math.max(5, asInt(req.query.limit, 20)));
  const skip = (page - 1) * limit;

  const query = {};
  if (houseId) query.houseId = houseId;

  const [rows, total] = await Promise.all([
    BiggiHouseMembership.find(query)
      .populate("houseId", "number minimum")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    BiggiHouseMembership.countDocuments(query),
  ]);

  const userIds = rows.map((r) => r.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select("_id username email phoneNumber");
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  res.json({
    success: true,
    page,
    limit,
    total,
    memberships: rows.map((m) => {
      const u = userMap.get(String(m.userId));
      return {
        id: String(m._id),
        joinedAt: m.joinedAt,
        lastPaidAt: m.lastPaidAt,
        house: m.houseId
          ? {
              id: String(m.houseId._id),
              number: m.houseId.number,
              minimum: m.houseId.minimum,
            }
          : null,
        user: u
          ? {
              id: String(u._id),
              username: u.username,
              email: u.email,
              phoneNumber: u.phoneNumber || "",
            }
          : { id: String(m.userId) },
      };
    }),
  });
};

export const adminDeleteMembership = async (req, res) => {
  const membershipId = String(req.params.id || "").trim();
  if (!membershipId) {
    return res.status(400).json({ success: false, error: "Invalid membership id" });
  }
  const deleted = await BiggiHouseMembership.findByIdAndDelete(membershipId);
  if (!deleted) return res.status(404).json({ success: false, error: "Membership not found" });
  return res.json({ success: true, message: "Membership removed" });
};

// -------------------------
// Subscription Endpoints
// -------------------------

export const getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("subscription");
    const subscription = user?.subscription;

    if (!subscription) {
      return res.json({
        subscriptionExists: false,
        isActive: false,
        subscription: null,
      });
    }

    return res.json({
      subscriptionExists: true,
      isActive: subscription.isActive && new Date(subscription.renewalDate) > new Date(),
      subscription: {
        id: subscription._id.toString(),
        monthlyFee: subscription.monthlyFee,
        isActive: subscription.isActive,
        startDate: subscription.startDate,
        renewalDate: subscription.renewalDate,
        lastPaymentDate: subscription.lastPaymentDate,
        autoRenew: subscription.autoRenew,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch subscription status" });
  }
};

export const subscribe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user already has an active subscription
    if (user.subscription) {
      const existingSubscription = await Subscription.findById(user.subscription);
      if (existingSubscription && existingSubscription.isActive) {
        return res.status(400).json({
          error: "You already have an active subscription",
          subscription: {
            id: existingSubscription._id.toString(),
            monthlyFee: existingSubscription.monthlyFee,
            isActive: existingSubscription.isActive,
            renewalDate: existingSubscription.renewalDate,
          },
        });
      }
    }

    const WEEKLY_FEE = 50;
    const wallet = await ensureWallet(req.user.id);
    const previousBalance = Number(wallet.balance || 0);
    if (previousBalance < WEEKLY_FEE) {
      return res.status(400).json({
        error: "Insufficient BiggiHouse wallet balance to pay the subscription fee",
        requiredAmount: WEEKLY_FEE,
        currentBalance: previousBalance,
      });
    }

    wallet.balance = previousBalance - WEEKLY_FEE;
    wallet.lastUpdated = new Date();
    wallet.transactions.unshift({
      type: "subscription",
      amount: WEEKLY_FEE,
      status: "completed",
      reference: `bh_sub_${req.user.id}_${Date.now()}`,
      meta: {
        action: "subscription_payment",
        paymentMethod: "wallet",
        previousBalance,
        newBalance: wallet.balance,
      },
    });
    wallet.transactions = wallet.transactions.slice(0, 100);
    await wallet.save();

    let subscription;
    if (user.subscription) {
      subscription = await Subscription.findByIdAndUpdate(
        user.subscription,
        {
          monthlyFee: WEEKLY_FEE,
          isActive: true,
          startDate: new Date(),
          renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          lastPaymentDate: new Date(),
          autoRenew: req.body.autoRenew !== false,
          paymentMethod: "wallet",
        },
        { new: true }
      );
    } else {
      subscription = await Subscription.create({
        user: user._id,
        monthlyFee: WEEKLY_FEE,
        isActive: true,
        startDate: new Date(),
        renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        lastPaymentDate: new Date(),
        autoRenew: req.body.autoRenew !== false,
        paymentMethod: "wallet",
      });
      user.subscription = subscription._id;
      await user.save();
    }

    return res.status(201).json({
      message: "Subscription activated successfully",
      subscription: {
        id: subscription._id.toString(),
        monthlyFee: subscription.monthlyFee,
        isActive: subscription.isActive,
        startDate: subscription.startDate,
        renewalDate: subscription.renewalDate,
        lastPaymentDate: subscription.lastPaymentDate,
        autoRenew: subscription.autoRenew,
        paymentMethod: subscription.paymentMethod,
      },
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to create subscription" });
  }
};

export const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.subscription) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const subscription = await Subscription.findByIdAndUpdate(
      user.subscription,
      {
        isActive: false,
        autoRenew: false,
      },
      { new: true }
    );

    return res.json({
      message: "Subscription cancelled successfully",
      subscription: {
        id: subscription._id.toString(),
        isActive: subscription.isActive,
        autoRenew: subscription.autoRenew,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to cancel subscription" });
  }
};

export const renewSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.subscription) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const subscription = await Subscription.findById(user.subscription);
    if (!subscription) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const wallet = await ensureWallet(req.user.id);
    const previousBalance = Number(wallet.balance || 0);
    if (previousBalance < subscription.monthlyFee) {
      return res.status(400).json({
        error: "Insufficient BiggiHouse wallet balance to renew the subscription",
        requiredAmount: subscription.monthlyFee,
        currentBalance: previousBalance,
      });
    }

    wallet.balance = previousBalance - subscription.monthlyFee;
    wallet.lastUpdated = new Date();
    wallet.transactions.unshift({
      type: "subscription",
      amount: subscription.monthlyFee,
      status: "completed",
      reference: `bh_sub_renew_${req.user.id}_${Date.now()}`,
      meta: {
        action: "subscription_renewal",
        paymentMethod: "wallet",
        previousBalance,
        newBalance: wallet.balance,
      },
    });
    wallet.transactions = wallet.transactions.slice(0, 100);
    await wallet.save();

    const updatedSubscription = await Subscription.findByIdAndUpdate(
      user.subscription,
      {
        isActive: true,
        renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        lastPaymentDate: new Date(),
        paymentMethod: "wallet",
      },
      { new: true }
    );

    return res.json({
      message: "Subscription renewed successfully",
      subscription: {
        id: updatedSubscription._id.toString(),
        monthlyFee: updatedSubscription.monthlyFee,
        isActive: updatedSubscription.isActive,
        renewalDate: updatedSubscription.renewalDate,
        lastPaymentDate: updatedSubscription.lastPaymentDate,
        paymentMethod: updatedSubscription.paymentMethod,
      },
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to renew subscription" });
  }
};

// -------------------------
// Winner Selection & Payout
// -------------------------

const getCurrentWeekRange = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // If it's Sunday, use the current week. Otherwise, use the previous week.
  const weekEnd = new Date(now);
  if (dayOfWeek !== 0) {
    weekEnd.setDate(now.getDate() - dayOfWeek); // Go back to last Sunday
  }
  weekEnd.setHours(23, 59, 59, 999); // End of Sunday

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6); // Monday of the same week
  weekStart.setHours(0, 0, 0, 0);

  return { weekStart, weekEnd };
};

const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const selectWeeklyWinners = async () => {
  try {
    const { weekStart, weekEnd } = getCurrentWeekRange();

    // Check if winners have already been selected for this week
    const existingWinners = await BiggiHouseWinner.findOne({ weekStart });
    if (existingWinners) {
      console.log(`Winners already selected for week ${weekStart.toISOString()} - ${weekEnd.toISOString()}`);
      return;
    }

    // Get all active houses
    const houses = await BiggiHouseHouse.find({ active: true });

    for (const house of houses) {
      // Get all members of this house
      const memberships = await BiggiHouseMembership.find({ houseId: house._id });
      if (memberships.length === 0) continue;

      const memberIds = memberships.map(m => m.userId);

      // If less than 10 members, select all of them
      const numWinners = Math.min(10, memberIds.length);

      // Shuffle and select winners
      const shuffledMembers = shuffleArray(memberIds);
      const selectedWinners = shuffledMembers.slice(0, numWinners);

      // Calculate payout per winner (total pool divided equally)
      const totalPool = memberships.length * house.minimum;
      const payoutPerWinner = Math.floor(totalPool / numWinners);

      // Create winner records
      const winnerRecords = selectedWinners.map(userId => ({
        houseId: house._id,
        userId,
        weekStart,
        weekEnd,
        amount: payoutPerWinner,
        status: 'pending'
      }));

      await BiggiHouseWinner.insertMany(winnerRecords);

      console.log(`Selected ${numWinners} winners for House ${house.number}, payout: ₦${payoutPerWinner} each`);
    }

    console.log(`Weekly winner selection completed for ${weekStart.toISOString()} - ${weekEnd.toISOString()}`);
  } catch (error) {
    console.error('Error selecting weekly winners:', error);
  }
};

export const processWeeklyPayouts = async () => {
  try {
    const { weekStart } = getCurrentWeekRange();

    // Get all pending winners for this week
    const pendingWinners = await BiggiHouseWinner.find({
      weekStart,
      status: 'pending'
    }).populate('userId houseId');

    for (const winner of pendingWinners) {
      try {
        // Ensure winner has a wallet
        const wallet = await ensureWallet(winner.userId._id);

        // Add payout to wallet
        const previousBalance = Number(wallet.balance || 0);
        wallet.balance = previousBalance + winner.amount;
        wallet.lastUpdated = new Date();

        // Add transaction record
        const transactionRef = `bh_payout_${winner._id}_${Date.now()}`;
        wallet.transactions.unshift({
          type: "deposit",
          amount: winner.amount,
          status: "completed",
          reference: transactionRef,
          meta: {
            action: "weekly_payout",
            houseId: winner.houseId._id,
            houseNumber: winner.houseId.number,
            weekStart: winner.weekStart,
            weekEnd: winner.weekEnd,
            previousBalance,
            newBalance: wallet.balance,
          },
        });
        wallet.transactions = wallet.transactions.slice(0, 100);
        await wallet.save();

        // Mark winner as paid
        winner.status = 'paid';
        winner.paidAt = new Date();
        winner.transactionRef = transactionRef;
        await winner.save();

        console.log(`Paid ₦${winner.amount} to user ${winner.userId.username || winner.userId.email} for House ${winner.houseId.number}`);
      } catch (walletError) {
        console.error(`Error processing payout for winner ${winner._id}:`, walletError);
      }
    }

    console.log(`Weekly payouts processed for ${pendingWinners.length} winners`);
  } catch (error) {
    console.error('Error processing weekly payouts:', error);
  }
};

// Admin endpoint to get winner records
export const adminGetWinners = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.houseId) query.houseId = req.query.houseId;
    if (req.query.status) query.status = req.query.status;
    if (req.query.weekStart) query.weekStart = new Date(req.query.weekStart);

    const winners = await BiggiHouseWinner.find(query)
      .populate('userId', 'username email phoneNumber')
      .populate('houseId', 'number minimum')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await BiggiHouseWinner.countDocuments(query);

    res.json({
      success: true,
      winners: winners.map(w => ({
        id: String(w._id),
        house: {
          id: String(w.houseId._id),
          number: w.houseId.number,
          minimum: w.houseId.minimum,
        },
        user: {
          id: String(w.userId._id),
          username: w.userId.username,
          email: w.userId.email,
          phoneNumber: w.userId.phoneNumber,
        },
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        amount: w.amount,
        status: w.status,
        paidAt: w.paidAt,
        transactionRef: w.transactionRef,
        createdAt: w.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin endpoint to manually trigger winner selection
export const adminTriggerWinnerSelection = async (req, res) => {
  try {
    await selectWeeklyWinners();
    res.json({ success: true, message: 'Winner selection completed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin endpoint to manually trigger payouts
export const adminTriggerPayouts = async (req, res) => {
  try {
    await processWeeklyPayouts();
    res.json({ success: true, message: 'Payouts processed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
