// backend/controllers/walletController.js
import User from "../models/User.js";
import Withdraw from "../models/withdrawModel.js";
import Deposit from "../models/Deposit.js";
import axios from "axios";
import mongoose from "mongoose";
import { logWalletTransaction } from "../utils/wallet.js";

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
   FLUTTERWAVE WITHDRAWAL (TRANSFER API)
===================================================== */
export const flutterwaveWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const userId = req.user.id;
    const {
      tx_ref,
      amount,
      account_bank,
      account_number,
      beneficiary_name,
      narration,
      currency = "NGN"
    } = req.body;

    if (!tx_ref || !amount || !account_bank || !account_number || !beneficiary_name) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is ₦100",
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.mainBalance < numericAmount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
      });
    }

    // Check if transaction reference already exists
    const existingWithdrawal = await Withdraw.findOne({ reference: tx_ref }).session(session);
    if (existingWithdrawal) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Duplicate transaction reference",
      });
    }

    // Call Flutterwave transfer API
    const flutterwaveResponse = await axios.post(
      "https://api.flutterwave.com/v3/transfers",
      {
        account_bank,
        account_number,
        amount: numericAmount,
        narration: narration || `Withdrawal from Biggi Data`,
        currency,
        reference: tx_ref,
        beneficiary_name,
        callback_url: `${process.env.BASE_URL || "http://localhost:5000"}/api/v1/wallet/withdraw-webhook`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const transferData = flutterwaveResponse.data.data;

    if (flutterwaveResponse.data.status !== "success") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Flutterwave transfer failed",
        error: flutterwaveResponse.data.message,
      });
    }

    // Deduct from user's balance
    user.mainBalance -= numericAmount;
    await user.save({ session });

    // Create withdrawal record
    const newWithdraw = await Withdraw.create([{
      user: userId,
      method: "Flutterwave",
      bank: account_bank,
      accountNumber: account_number,
      accountName: beneficiary_name,
      amount: numericAmount,
      status: "pending",
      reference: tx_ref,
      flutterwaveTransferId: transferData.id,
      meta: {
        bank_code: account_bank,
        full_response: transferData,
      },
    }], { session });

    // Log wallet transaction
    await logWalletTransaction(
      userId,
      "withdraw",
      numericAmount,
      tx_ref,
      "pending"
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Withdrawal initiated via Flutterwave",
      withdrawal: {
        id: newWithdraw[0]._id,
        amount: newWithdraw[0].amount,
        status: newWithdraw[0].status,
        reference: newWithdraw[0].reference,
        createdAt: newWithdraw[0].createdAt,
      },
      transfer: {
        id: transferData.id,
        status: transferData.status,
        reference: transferData.reference,
      },
      balance: user.mainBalance,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Flutterwave withdrawal error:", err);
    
    // Check if it's an axios error
    if (err.response) {
      console.error("Flutterwave API response:", err.response.data);
      return res.status(err.response.status || 500).json({
        success: false,
        message: "Flutterwave API error",
        error: err.response.data?.message || err.response.data,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to process withdrawal via Flutterwave",
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

/* =====================================================
   FLUTTERWAVE WITHDRAWAL WEBHOOK
===================================================== */
export const flutterwaveWithdrawWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      console.error("Invalid webhook signature");
      return res.sendStatus(401);
    }

    const payload = req.body;
    const { event, data } = payload;

    if (event === "transfer.completed") {
      const { id, status, reference } = data;
      
      // Find withdrawal by Flutterwave transfer ID or reference
      const withdrawal = await Withdraw.findOne({
        $or: [
          { flutterwaveTransferId: id },
          { reference: reference }
        ]
      });

      if (withdrawal) {
        // Update withdrawal status
        withdrawal.status = status === "SUCCESSFUL" ? "approved" : "rejected";
        await withdrawal.save();

        // If transfer failed, refund user
        if (status === "FAILED") {
          const user = await User.findById(withdrawal.user);
          if (user) {
            user.mainBalance += withdrawal.amount;
            await user.save();
          }
        }

        // Update wallet transaction log
        await logWalletTransaction(
          withdrawal.user,
          "withdraw",
          withdrawal.amount,
          withdrawal.reference,
          status === "SUCCESSFUL" ? "success" : "failed"
        );

        console.log(`Withdrawal ${withdrawal._id} updated to status: ${status}`);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Withdrawal webhook error:", err);
    return res.sendStatus(200); // Always return 200 to prevent retries
  }
};

/* =====================================================
   VERIFY BANK ACCOUNT (FOR FRONTEND) - UPDATED FOR OPAY
===================================================== */
export const verifyBankAccount = async (req, res) => {
  try {
    const { account_number, bank_code, is_fintech, bank_name } = req.body;

    if (!account_number || !bank_code) {
      return res.status(400).json({
        success: false,
        message: "Account number and bank code are required",
      });
    }

    // Map bank codes for fintechs that need special handling
    let flutterwaveBankCode = bank_code;
    let bankNameForVerification = bank_name || "";
    
    // Special handling for OPay and other fintechs
    if (is_fintech || bank_name?.toLowerCase().includes("opay")) {
      // For OPay, we need to use the correct Flutterwave bank code
      flutterwaveBankCode = "099"; // OPay's Flutterwave code
      
      // Note: Flutterwave might not support account verification for all fintechs
      // We'll try but also provide fallback
      console.log(`Attempting OPay verification with code: ${flutterwaveBankCode}`);
    }

    try {
      const response = await axios.post(
        "https://api.flutterwave.com/v3/accounts/resolve",
        {
          account_number,
          account_bank: flutterwaveBankCode,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (response.data.status === "success") {
        return res.json({
          success: true,
          account_name: response.data.data.account_name,
          account_number: response.data.data.account_number,
          is_verified: true,
        });
      } else {
        // For fintechs, we might get an error but can still proceed
        if (is_fintech) {
          return res.json({
            success: true,
            account_name: "Fintech Account Holder",
            account_number: account_number,
            is_verified: false,
            message: "Account verification limited for this fintech. Please ensure details are correct.",
          });
        }
        
        return res.status(400).json({
          success: false,
          message: "Account verification failed",
          error: response.data.message,
        });
      }
    } catch (flutterwaveError) {
      console.error("Flutterwave verification error:", flutterwaveError.response?.data || flutterwaveError.message);
      
      // Special handling for OPay/Fintech errors
      if (is_fintech || bank_name?.toLowerCase().includes("opay")) {
        // For fintechs, we allow proceeding with manual verification
        return res.json({
          success: true,
          account_name: "OPay Account Holder",
          account_number: account_number,
          is_verified: false,
          message: "Proceed with manual verification. Ensure account details are correct.",
          requires_manual_check: true,
        });
      }
      
      // For traditional banks, return the error
      if (flutterwaveError.response) {
        const errorMessage = flutterwaveError.response.data?.message || "Invalid account details";
        return res.status(400).json({
          success: false,
          message: errorMessage,
          error: flutterwaveError.response.data,
        });
      }
      
      throw flutterwaveError;
    }
  } catch (err) {
    console.error("Account verification error:", err);
    
    res.status(500).json({
      success: false,
      message: "Failed to verify account. Please try again.",
      error: err.message,
    });
  }
};

/* =====================================================
   WITHDRAW FUNDS (LEGACY - FOR BACKWARD COMPATIBILITY)
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

    // Generate transaction reference
    const reference = `legacy_withdraw_${userId}_${Date.now()}`;

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
      reference,
    });

    // Log transaction
    await logWalletTransaction(
      userId,
      "withdraw",
      numericAmount,
      reference,
      "pending"
    );

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
      .select("-__v")
      .limit(50);

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
      .select("-__v -gatewayResponse")
      .limit(50);

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