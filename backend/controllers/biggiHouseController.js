import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import BiggiHouseWallet from "../models/BiggiHouseWallet.js";
import BiggiHouseHouse from "../models/BiggiHouseHouse.js";
import BiggiHouseMembership from "../models/BiggiHouseMembership.js";
import BiggiHouseVendorRequest from "../models/BiggiHouseVendorRequest.js";
import { ensureBiggiHouseSeed } from "../utils/biggiHouseSeed.js";

const txStatusAllowed = ["success", "success_price_mismatch", "simulated"];

const getWeeklyWindowStart = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  return start;
};

const normalizePhone = (value) => String(value || "").replace(/\s+/g, "").trim();

const ensureWallet = async (userId) => {
  const wallet = await BiggiHouseWallet.findOne({ userId });
  if (wallet) return wallet;
  return BiggiHouseWallet.create({ userId, balance: 0, currency: "NGN" });
};

export const getBiggiHouseHouses = async (req, res) => {
  await ensureBiggiHouseSeed();
  const houses = await BiggiHouseHouse.find({ active: true }).sort({ number: 1 });

  const memberCounts = await BiggiHouseMembership.aggregate([
    { $group: { _id: "$houseId", members: { $sum: 1 } } },
  ]);
  const countMap = new Map(memberCounts.map((row) => [String(row._id), row.members]));

  res.json({
    success: true,
    houses: houses.map((house) => ({
      id: String(house._id),
      number: house.number,
      minimum: house.minimum,
      members: Number(countMap.get(String(house._id)) || 0),
      maxUsers: null,
      totalPool: house.minimum * 10,
      status: "Open",
    })),
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

export const getBiggiHouseVendors = async (req, res) => {
  const vendors = await User.find({ userRole: "merchant" })
    .select("_id username phoneNumber isVerified photo")
    .sort({ username: 1 });

  res.json({
    success: true,
    vendors: vendors.map((vendor) => ({
      id: String(vendor._id),
      username: vendor.username,
      phoneNumber: vendor.phoneNumber,
      isVerified: Boolean(vendor.isVerified),
      photo: vendor.photo || null,
    })),
  });
};

export const createBiggiHouseVendorRequest = async (req, res) => {
  const vendorUserId = String(req.body?.vendorUserId || "").trim();
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  const network = String(req.body?.network || "").trim() || null;
  const planId = String(req.body?.planId || "").trim() || null;
  const note = String(req.body?.note || "").trim();

  if (!vendorUserId || !phoneNumber) {
    return res.status(400).json({
      success: false,
      error: "vendorUserId and phoneNumber are required",
    });
  }

  const vendor = await User.findById(vendorUserId).select("_id userRole username");
  if (!vendor || String(vendor.userRole || "").toLowerCase() !== "merchant") {
    return res.status(400).json({ success: false, error: "Selected vendor is not a merchant" });
  }

  const request = await BiggiHouseVendorRequest.create({
    requesterUserId: req.user.id,
    vendorUserId,
    phoneNumber,
    network,
    planId,
    note,
    status: "pending",
  });

  try {
    const vendorUser = await User.findById(vendorUserId);
    if (vendorUser) {
      vendorUser.addNotification({
        type: "BiggiHouse Data Request",
        status: "info",
        message: `A BiggiHouse user requested a data purchase for ${phoneNumber}.`,
      });
      await vendorUser.save({ validateBeforeSave: false });
    }
  } catch {
    // Best-effort notification.
  }

  res.status(201).json({ success: true, request });
};

export const getMerchantBiggiHouseRequests = async (req, res) => {
  const role = String(req.user.userRole || "").toLowerCase();
  if (role !== "merchant") {
    return res.status(403).json({ success: false, error: "Merchant access required" });
  }

  const requests = await BiggiHouseVendorRequest.find({ vendorUserId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({ success: true, requests });
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

  const windowStart = getWeeklyWindowStart();
  const exists = await Wallet.exists({
    transactions: {
      $elemMatch: {
        type: "purchase",
        status: { $in: txStatusAllowed },
        date: { $gte: windowStart },
        "meta.action": "data_purchase",
        "meta.mobile_no": phoneNumber,
      },
    },
  });

  res.json({
    success: true,
    eligible: Boolean(exists),
    reason: exists ? "OK" : "NO_PURCHASE_THIS_WEEK",
    phoneNumber,
    windowStart,
  });
};

export const joinBiggiHouse = async (req, res) => {
  await ensureBiggiHouseSeed();

  const eligibility = await (async () => {
    const me = await User.findById(req.user.id).select("phoneNumber");
    const phoneNumber = normalizePhone(me?.phoneNumber);
    if (!phoneNumber) return { ok: false, reason: "MISSING_PHONE_NUMBER" };

    const windowStart = getWeeklyWindowStart();
    const exists = await Wallet.exists({
      transactions: {
        $elemMatch: {
          type: "purchase",
          status: { $in: txStatusAllowed },
          date: { $gte: windowStart },
          "meta.action": "data_purchase",
          "meta.mobile_no": phoneNumber,
        },
      },
    });
    return exists ? { ok: true } : { ok: false, reason: "NO_PURCHASE_THIS_WEEK" };
  })();

  if (!eligibility.ok) {
    return res.status(403).json({
      success: false,
      error: "You must buy at least 1 data bundle this week before joining a house.",
      errorCode: eligibility.reason,
    });
  }

  const houseId = String(req.params.id || "").trim();
  const house = await BiggiHouseHouse.findById(houseId);
  if (!house || !house.active) {
    return res.status(404).json({ success: false, error: "House not found" });
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
    house: {
      id: String(house._id),
      number: house.number,
      minimum: house.minimum,
      members: memberCount,
      maxUsers: null,
      totalPool: house.minimum * 10,
      status: "In Progress",
    },
    wallet: { balance: wallet.balance, currency: wallet.currency },
  });
};
