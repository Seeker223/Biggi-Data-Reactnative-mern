import axios from "axios";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import BiggiHouseWallet from "../models/BiggiHouseWallet.js";
import BiggiHouseHouse from "../models/BiggiHouseHouse.js";
import BiggiHouseMembership from "../models/BiggiHouseMembership.js";
import BiggiHouseVendorRequest from "../models/BiggiHouseVendorRequest.js";
import { ensureBiggiHouseSeed } from "../utils/biggiHouseSeed.js";
import { getDepositFeeSettings, computeDepositFee } from "../utils/depositFee.js";

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
  const settings = await getDepositFeeSettings();
  return res.json({ success: true, settings });
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
    const feeSettings = await getDepositFeeSettings();
    const serviceCharge = computeDepositFee(requestedAmount, feeSettings);
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
