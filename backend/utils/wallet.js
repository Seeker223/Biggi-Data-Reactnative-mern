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
    });

    wallet.lastUpdated = new Date();
    await wallet.save();
  } catch (err) {
    console.error("Wallet transaction log failed:", err.message);
  }
};
