// backend/utils/wallet.js
import Wallet from "../models/Wallet.js";
import User from "../models/User.js";

/**
 * Sync Wallet.balance with User.mainBalance
 */
export const syncWalletBalance = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found for wallet sync");

    let wallet = await Wallet.findOne({ userId, type: "main" });

    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        type: "main",
        balance: user.mainBalance,
        transactions: [],
        lastUpdated: new Date(),
      });
      return wallet;
    }

    wallet.balance = user.mainBalance;
    wallet.lastUpdated = new Date();
    await wallet.save();
    return wallet;
  } catch (err) {
    console.error("Wallet sync failed:", err.message);
    return null;
  }
};

/**
 * Log wallet transaction safely
 */
export const logWalletTransaction = async (userId, type, amount, reference, status) => {
  try {
    const wallet = await syncWalletBalance(userId);
    if (!wallet) return;

    wallet.transactions.push({
      type,
      amount,
      date: new Date(),
      status,
      reference,
      meta: {},
    });

    wallet.lastUpdated = new Date();
    await wallet.save();
  } catch (err) {
    console.error("Wallet transaction log failed:", err.message);
  }
};

// New signature with metadata for better auditability. Keep old calls working.
export const logWalletTransactionWithMeta = async (
  userId,
  type,
  amount,
  reference,
  status,
  meta = {}
) => {
  try {
    const wallet = await syncWalletBalance(userId);
    if (!wallet) return;

    wallet.transactions.push({
      type,
      amount,
      date: new Date(),
      status,
      reference,
      meta: meta && typeof meta === "object" ? meta : {},
    });

    wallet.lastUpdated = new Date();
    await wallet.save();
  } catch (err) {
    console.error("Wallet transaction log failed:", err.message);
  }
};

/**
 * Update an existing wallet transaction by reference (pending -> success/failed).
 * Returns true when an update occurred, false when no matching transaction was found.
 */
export const updateWalletTransactionStatus = async (
  userId,
  reference,
  status,
  meta = {}
) => {
  try {
    const wallet = await syncWalletBalance(userId);
    if (!wallet) return false;

    const tx = (wallet.transactions || []).find((t) => t.reference === reference);
    if (!tx) return false;

    tx.status = status;
    if (meta && typeof meta === "object") {
      tx.meta = { ...(tx.meta || {}), ...meta };
    }
    tx.date = new Date();
    wallet.lastUpdated = new Date();
    await wallet.save();
    return true;
  } catch (err) {
    console.error("Wallet transaction update failed:", err.message);
    return false;
  }
};

/**
 * Ensure wallet.balance matches user.mainBalance and log a sync note if it doesn't.
 */
export const ensureWalletBalanceMatch = async (userId, reason = "balance_sync") => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found for wallet balance match");

    let wallet = await Wallet.findOne({ userId, type: "main" });
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        type: "main",
        balance: user.mainBalance,
        transactions: [],
        lastUpdated: new Date(),
      });
      return true;
    }

    if (wallet.balance !== user.mainBalance) {
      const previousBalance = wallet.balance;
      wallet.balance = user.mainBalance;
      wallet.transactions.push({
        type: "purchase",
        amount: 0,
        date: new Date(),
        status: "balance_sync",
        reference: `balance_sync_${Date.now()}`,
        meta: {
          reason,
          previousBalance,
          newBalance: user.mainBalance,
        },
      });
      wallet.lastUpdated = new Date();
      await wallet.save();
    }
    return true;
  } catch (err) {
    console.error("Wallet balance match failed:", err.message);
    return false;
  }
};
