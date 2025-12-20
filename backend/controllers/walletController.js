// backend/controllers/walletController.js
import User from "../models/User.js";
import Withdraw from "../models/withdrawModel.js";
import Deposit from "../models/Deposit.js";

/* =====================================================
   GET USER BALANCE
===================================================== */
export const getUserBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "mainBalance rewardBalance totalDeposits"
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      balance: {
        main: user.mainBalance,
        reward: user.rewardBalance,
        totalDeposits: user.totalDeposits,
      },
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch balance",
    });
  }
};

/* =====================================================
   WITHDRAW FUNDS
===================================================== */
export const withdrawFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { method, bank, accountNumber, accountName, amount } = req.body;

    if (!method || !accountNumber || !accountName || !amount) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is ₦100",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.mainBalance < numericAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
      });
    }

    // Deduct from user's balance
    user.mainBalance -= numericAmount;
    await user.save();

    // Create withdrawal record
    const newWithdraw = await Withdraw.create({
      user: userId,
      method,
      bank: method === "Bank Transfer" ? bank : "Opay",
      accountNumber,
      accountName,
      amount: numericAmount,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      message: "Withdrawal submitted successfully",
      withdrawal: {
        id: newWithdraw._id,
        amount: newWithdraw.amount,
        status: newWithdraw.status,
        method: newWithdraw.method,
        createdAt: newWithdraw.createdAt,
      },
      balance: user.mainBalance,
    });
  } catch (err) {
    console.error("WithdrawFunds Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while processing withdrawal",
    });
  }
};

/* =====================================================
   GET WITHDRAWAL HISTORY
===================================================== */
export const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const withdrawals = await Withdraw.find({ user: userId })
      .sort({ createdAt: -1 })
      .select("-__v");

    res.status(200).json({
      success: true,
      withdrawals,
      count: withdrawals.length,
    });
  } catch (err) {
    console.error("GetWithdrawalHistory Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawal history",
    });
  }
};

/* =====================================================
   GET DEPOSIT HISTORY
===================================================== */
export const getDepositHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const deposits = await Deposit.find({ user: userId })
      .sort({ createdAt: -1 })
      .select("-__v -gatewayResponse");

    res.status(200).json({
      success: true,
      deposits,
      count: deposits.length,
    });
  } catch (err) {
    console.error("GetDepositHistory Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deposit history",
    });
  }
};

/* =====================================================
   GET DEPOSIT STATISTICS
===================================================== */
export const getDepositStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deposits = await Deposit.find({
      user: userId,
      status: "successful",
      createdAt: { $gte: thirtyDaysAgo },
    });

    const totalAmount = deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
    const depositCount = deposits.length;
    const averageDeposit = depositCount > 0 ? totalAmount / depositCount : 0;

    res.json({
      success: true,
      stats: {
        totalDeposits: depositCount,
        totalAmount,
        averageDeposit,
        last30Days: deposits.length,
      },
    });
  } catch (error) {
    console.error("Get deposit stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deposit statistics",
    });
  }
};