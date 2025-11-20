// backend/utils/wallet.js
import Wallet from "../models/Wallet.js";
import User from "../models/User.js";

/**
 * Syncs Wallet.balance with User.mainBalance
 * Ensures wallet always reflects current user main balance
 */
export const syncWalletBalance = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found for wallet sync");

    let wallet = await Wallet.findOne({ userId, type: "main" });

    if (!wallet) {
      // Create wallet if missing
      wallet = await Wallet.create({
        userId,
        type: "main",
        balance: user.mainBalance,
        transactions: [],
      });
      return wallet;
    }

    wallet.balance = user.mainBalance;
    await wallet.save();

    return wallet;
  } catch (err) {
    console.error("Wallet sync failed:", err.message);
    return null;
  }
};

/**
 * Logs a wallet transaction safely
 */
export const logWalletTransaction = async (userId, type, amount, reference, status) => {
  try {
    const wallet = await syncWalletBalance(userId); // Ensure balance is synced
    if (!wallet) return;

    wallet.transactions.push({
      type,
      amount,
      date: new Date(),
      status,
      reference,
    });

    await wallet.save();
  } catch (err) {
    console.error("Wallet transaction log failed:", err.message);
  }
};
