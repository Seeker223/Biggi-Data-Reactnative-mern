import axios from "axios";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import BiggiHouseWallet from "../models/BiggiHouseWallet.js";
import BiggiHouseHouse from "../models/BiggiHouseHouse.js";
import BiggiHouseMembership from "../models/BiggiHouseMembership.js";
import BiggiHouseVendorRequest from "../models/BiggiHouseVendorRequest.js";
import { ensureBiggiHouseSeed } from "../utils/biggiHouseSeed.js";
import { computeDepositFee } from "../utils/depositFee.js";

const txStatusAllowed = ["success", "success_price_mismatch", "simulated"];

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

const getWeeklyDataPurchaseStatsByPhone = async (phoneNumber) => {
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
  const me = await User.findById(req.user.id).select("userRole");
  const role = String(me?.userRole || "").toLowerCase();
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

  const stats = await getWeeklyDataPurchaseStatsByPhone(phoneNumber);

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

  const me = await User.findById(req.user.id).select("phoneNumber");
  const phoneNumber = normalizePhone(me?.phoneNumber);
  if (!phoneNumber) {
    return res.status(403).json({
      success: false,
      error: "You must add a phone number to your profile before joining a house.",
      errorCode: "MISSING_PHONE_NUMBER",
    });
  }

  const stats = await getWeeklyDataPurchaseStatsByPhone(phoneNumber);
  const requiredPurchases = Math.max(1, Number(house.number || 1));
  if (stats.count < requiredPurchases) {
    return res.status(403).json({
      success: false,
      error: `You must buy data at least ${requiredPurchases} time(s) this week before joining House ${house.number}.`,
      errorCode: "INSUFFICIENT_WEEKLY_PURCHASES",
      requiredPurchases,
      purchasesThisWeek: stats.count,
      phoneNumber,
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

  const [totalHouses, activeHouses, totalMemberships, pendingVendorRequests] =
    await Promise.all([
      BiggiHouseHouse.countDocuments({}),
      BiggiHouseHouse.countDocuments({ active: true }),
      BiggiHouseMembership.countDocuments({}),
      BiggiHouseVendorRequest.countDocuments({ status: "pending" }),
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
      vendorRequests: { pending: pendingVendorRequests },
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
        "_id username email phoneNumber role userRole isVerified allowedApps createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(query),
  ]);

  res.json({
    success: true,
    page,
    limit,
    total,
    users: rows.map((u) => ({
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

export const adminListVendorRequests = async (req, res) => {
  const status = String(req.query.status || "").trim();
  const page = Math.max(1, asInt(req.query.page, 1));
  const limit = Math.min(50, Math.max(5, asInt(req.query.limit, 20)));
  const skip = (page - 1) * limit;

  const query = {};
  if (status) query.status = status;

  const [rows, total] = await Promise.all([
    BiggiHouseVendorRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    BiggiHouseVendorRequest.countDocuments(query),
  ]);

  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.requesterUserId, r.vendorUserId])
        .filter(Boolean)
        .map((id) => String(id))
    ),
  ];
  const users = await User.find({ _id: { $in: userIds } }).select("_id username email phoneNumber");
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  res.json({
    success: true,
    page,
    limit,
    total,
    requests: rows.map((r) => ({
      id: String(r._id),
      phoneNumber: r.phoneNumber,
      network: r.network,
      planId: r.planId,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
      requester: (() => {
        const u = userMap.get(String(r.requesterUserId));
        return u
          ? { id: String(u._id), username: u.username, email: u.email, phoneNumber: u.phoneNumber || "" }
          : { id: String(r.requesterUserId) };
      })(),
      vendor: (() => {
        const u = userMap.get(String(r.vendorUserId));
        return u
          ? { id: String(u._id), username: u.username, email: u.email, phoneNumber: u.phoneNumber || "" }
          : { id: String(r.vendorUserId) };
      })(),
    })),
  });
};

export const adminUpdateVendorRequest = async (req, res) => {
  const requestId = String(req.params.id || "").trim();
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();
  const allowed = ["pending", "accepted", "rejected", "completed", "cancelled"];
  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  const updated = await BiggiHouseVendorRequest.findByIdAndUpdate(
    requestId,
    { $set: { status: nextStatus } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ success: false, error: "Request not found" });
  return res.json({ success: true, request: updated });
};
