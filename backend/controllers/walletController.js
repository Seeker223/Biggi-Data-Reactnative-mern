import User from "../models/User.js";
import Withdraw from "../models/withdrawModel.js";
import Deposit from "../models/Deposit.js";
import axios from "axios";
import mongoose from "mongoose";
import { logWalletTransaction } from "../utils/wallet.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";
import { verifyTransactionAuthorization } from "../utils/transactionAuth.js";
import { handleProfitSweepWebhook } from "../utils/profitSweep.js";
import { getDepositFeeSettings as fetchDepositFeeSettings } from "../utils/depositFee.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";
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
   REDEEM REWARDS (MOVE rewardBalance -> mainBalance)
===================================================== */
export const redeemRewards = async (req, res) => {
  // Feature flag: disable redeem during review window
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Reward redemption is temporarily disabled for review.",
    });
  }

  try {
    const userId = req.user.id;
    const requestedAmount = Number(req.body?.amount || 0);
    const biometricProof = String(req.body?.biometricProof || "").trim();
    const transactionPin = String(req.body?.transactionPin || "").trim();

    const user = await User.findById(userId).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const rewardBalance = Number(user.rewardBalance || 0);
    if (rewardBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: "No reward balance available to redeem",
      });
    }

    // If amount is passed, redeem that amount; otherwise redeem full reward balance.
    const amountToRedeem = requestedAmount > 0 ? requestedAmount : rewardBalance;

    if (amountToRedeem < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum redeem amount is ₦100",
      });
    }

    if (amountToRedeem > rewardBalance) {
      return res.status(400).json({
        success: false,
        message: "Insufficient reward balance",
      });
    }

    const authCheck = await verifyTransactionAuthorization({
      user,
      expectedAction: "redeem",
      expectedAmount: amountToRedeem,
      biometricProof,
      transactionPin,
    });
    if (!authCheck.ok) {
      return res.status(400).json({
        success: false,
        message: authCheck.message,
      });
    }

    user.rewardBalance = rewardBalance - amountToRedeem;
    user.mainBalance = Number(user.mainBalance || 0) + amountToRedeem;
    user.addNotification({
      type: "Redeem",
      status: "success",
      amount: amountToRedeem,
      message: `Redeemed ₦${amountToRedeem.toLocaleString()} to main balance.`,
    });
    await user.save();

    await logWalletTransaction(
      userId,
      "redeem",
      amountToRedeem,
      `redeem_${userId}_${Date.now()}`,
      "success"
    );

    await sendUserEmail({
      userId: userId,
      type: "redeem",
      email: user.email,
      subject: "Redeem Successful",
      title: "Rewards Redeemed",
      bodyLines: [
        `You redeemed N${Number(amountToRedeem).toLocaleString()} to your main balance.`,
        `New main balance: N${Number(user.mainBalance || 0).toLocaleString()}.`,
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Rewards redeemed successfully",
      amountRedeemed: amountToRedeem,
      amountCredited: amountToRedeem,
      rewardBalance: user.rewardBalance,
      mainBalance: user.mainBalance,
    });
  } catch (error) {
    console.error("Redeem rewards error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to redeem rewards",
    });
  }
};

/* =====================================================
   FLUTTERWAVE WITHDRAWAL (TRANSFER API) - IMPROVED ERROR HANDLING
===================================================== */
export const flutterwaveWithdrawal = async (req, res) => {
  // 🚩 Feature flag: Disable withdrawals during Play Store review
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Withdrawals are temporarily disabled for review.",
    });
  }

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
    const biometricProof = String(req.body?.biometricProof || "").trim();
    const transactionPin = String(req.body?.transactionPin || "").trim();

    // Enhanced validation
    if (!tx_ref || !amount || !account_bank || !account_number || !beneficiary_name) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
        required_fields: ["tx_ref", "amount", "account_bank", "account_number", "beneficiary_name"]
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is ₦100",
        provided_amount: amount
      });
    }

    // Check if amount exceeds Flutterwave maximum (usually 5,000,000 NGN)
    if (numericAmount > 5000000) {
      return res.status(400).json({
        success: false,
        message: "Maximum withdrawal amount is ₦5,000,000",
        provided_amount: numericAmount
      });
    }

    const user = await User.findById(userId).select("+transactionPinHash").session(session);
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
        user_balance: user.mainBalance,
        withdrawal_amount: numericAmount
      });
    }

    const authCheck = await verifyTransactionAuthorization({
      user,
      expectedAction: "withdraw",
      expectedAmount: numericAmount,
      biometricProof,
      transactionPin,
    });
    if (!authCheck.ok) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: authCheck.message,
      });
    }

    // Check if transaction reference already exists
    const existingWithdrawal = await Withdraw.findOne({ reference: tx_ref }).session(session);
    if (existingWithdrawal) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Duplicate transaction reference",
        reference: tx_ref
      });
    }

    // Log request for debugging
    console.log(`🚀 Flutterwave withdrawal request:`, {
      userId,
      amount: numericAmount,
      account_bank,
      account_number: `${account_number.substring(0, 3)}...`,
      beneficiary_name,
      reference: tx_ref,
      narration
    });

    // Call Flutterwave transfer API with enhanced error handling
    let flutterwaveResponse;
    try {
      flutterwaveResponse = await axios.post(
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
    } catch (axiosError) {
      // Log detailed axios error
      console.error("❌ AXIOS ERROR DETAILS:", {
        message: axiosError.message,
        code: axiosError.code,
        response: axiosError.response ? {
          status: axiosError.response.status,
          data: axiosError.response.data
        } : null,
        request: axiosError.request ? "Request made but no response" : null
      });
      throw axiosError; // Re-throw to be caught by outer catch block
    }

    const transferData = flutterwaveResponse.data.data;

    if (flutterwaveResponse.data.status !== "success") {
      await session.abortTransaction();
      console.error("❌ Flutterwave transfer failed:", flutterwaveResponse.data);
      
      return res.status(400).json({
        success: false,
        message: "Flutterwave transfer failed",
        error: flutterwaveResponse.data.message,
        full_response: flutterwaveResponse.data
      });
    }

    // Log successful Flutterwave response
    console.log(`✅ Flutterwave transfer initiated:`, {
      transferId: transferData.id,
      status: transferData.status,
      reference: transferData.reference
    });

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
    console.log(`✅ Withdrawal transaction committed for user ${userId}, amount: ₦${numericAmount}`);

    await sendUserEmail({
      userId: userId,
      type: "withdraw_requested",
      email: user.email,
      subject: "Withdrawal Submitted",
      title: "Withdrawal Request Received",
      bodyLines: [
        `Amount: N${Number(numericAmount).toLocaleString()}`,
        `Account: ${account_number} (${account_bank})`,
        `Reference: ${tx_ref}`,
        "We are processing your withdrawal.",
      ],
    });

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
        flutterwave_reference: transferData.flw_ref,
      },
      balance: user.mainBalance,
    });

  } catch (err) {
    await session.abortTransaction();
    
    // ENHANCED ERROR HANDLING WITH DETAILED LOGGING
    console.error("❌ FLUTTERWAVE WITHDRAWAL ERROR:", err.message);
    
    if (err.response) {
      // The request was made and the server responded with an error
      console.error("📡 Flutterwave API Error Status:", err.response.status);
      console.error("📦 Flutterwave Error Headers:", err.response.headers);
      console.error("📝 Flutterwave Error Response:", JSON.stringify(err.response.data, null, 2));
      
      // Extract Flutterwave's specific error message
      const fwError = err.response.data;
      const errorMsg = fwError?.message || fwError?.error?.message || "Unknown Flutterwave error";
      const errorCode = fwError?.error?.code || fwError?.code || "NO_CODE";
      
      // Map common Flutterwave error codes to user-friendly messages
      let userFriendlyMessage = errorMsg;
      let actionRequired = "Please try again later.";

      // Flutterwave Transfers can be restricted by IP whitelist settings.
      const lowerMsg = String(errorMsg || "").toLowerCase();
      if (lowerMsg.includes("whitelist") || lowerMsg.includes("whitelisting")) {
        userFriendlyMessage = "Withdrawals are temporarily unavailable due to a payment configuration issue.";
        actionRequired = "Admin: In Flutterwave dashboard, enable IP whitelisting and whitelist this server IP (static outbound IP required).";
      }
      
      switch(errorCode) {
        case "10401":
          userFriendlyMessage = "Invalid Flutterwave API key";
          actionRequired = "Check your FLUTTERWAVE_SECRET_KEY in .env file";
          break;
        case "10400":
          userFriendlyMessage = "Invalid withdrawal request parameters";
          actionRequired = "Check account details and try again";
          break;
        case "10403":
          userFriendlyMessage = "Insufficient permissions for transfers";
          actionRequired = "Contact Flutterwave support to enable transfers";
          break;
        case "1130400":
          userFriendlyMessage = "Amount below minimum transfer limit";
          actionRequired = "Increase withdrawal amount";
          break;
        case "10500":
          userFriendlyMessage = "Flutterwave server error";
          actionRequired = "Try again in a few minutes";
          break;
      }
      
      return res.status(err.response.status || 500).json({
        success: false,
        message: `Flutterwave API Error: ${userFriendlyMessage}`,
        errorCode: errorCode,
        errorDetails: fwError?.error || fwError,
        actionRequired: actionRequired
      });
      
    } else if (err.request) {
      // The request was made but no response was received
      console.error("📡 No response received from Flutterwave API");
      console.error("Request details:", err.request);
      
      return res.status(504).json({
        success: false,
        message: "Network timeout - Flutterwave servers not responding",
        error: "NETWORK_TIMEOUT",
        actionRequired: "Check your internet connection and try again"
      });
      
    } else {
      // Something else happened in setting up the request
      console.error("🔥 Flutterwave Request Setup Error:", err.message);
      console.error("Stack trace:", err.stack);
      
      return res.status(500).json({
        success: false,
        message: "Failed to setup withdrawal request",
        error: err.message,
        actionRequired: "Check server logs and try again"
      });
    }
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
      console.error("❌ Invalid webhook signature received");
      return res.sendStatus(401);
    }

    const payload = req.body;
    const { event, data } = payload;
    
    console.log(`🔔 Flutterwave webhook received: ${event}`, {
      id: data?.id,
      reference: data?.reference,
      status: data?.status
    });

    if (event === "transfer.completed") {
      const { id, status, reference } = data;
      
      // Profit sweep webhook (dedicated account transfer)
      try {
        const sweepRes = await handleProfitSweepWebhook({
          id,
          status,
          reference,
          raw: payload,
        });
        if (sweepRes?.ok && !sweepRes?.notFound) {
          return res.sendStatus(200);
        }
      } catch (e) {
        // Fall through to withdrawal handler
      }

      // Find withdrawal by Flutterwave transfer ID or reference
      const withdrawal = await Withdraw.findOne({
        $or: [
          { flutterwaveTransferId: id },
          { reference: reference }
        ]
      });

        if (withdrawal) {
          console.log(`📝 Updating withdrawal ${withdrawal._id} to status: ${status}`);
        
        // Update withdrawal status
        const oldStatus = withdrawal.status;
        withdrawal.status = status === "SUCCESSFUL" ? "approved" : "rejected";
        await withdrawal.save();

        // If transfer failed, refund user
        if (status === "FAILED") {
          const user = await User.findById(withdrawal.user);
          if (user) {
            user.mainBalance += withdrawal.amount;
            await user.save();
            console.log(`💰 Refunded ₦${withdrawal.amount} to user ${withdrawal.user}`);
            await sendUserEmail({
              userId: user._id,
              type: "withdraw_failed",
              email: user.email,
              subject: "Withdrawal Failed",
              title: "Withdrawal Failed",
              bodyLines: [
                `Your withdrawal of N${Number(withdrawal.amount).toLocaleString()} failed.`,
                "Your balance has been refunded.",
                `Reference: ${withdrawal.reference}`,
              ],
            });
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

        console.log(`✅ Withdrawal ${withdrawal._id} updated from ${oldStatus} to ${withdrawal.status}`);

        if (status === "SUCCESSFUL") {
          const user = await User.findById(withdrawal.user).select("email username");
          if (user) {
            await sendUserEmail({
              userId: user._id,
              type: "withdraw_success",
              email: user.email,
              subject: "Withdrawal Successful",
              title: "Withdrawal Completed",
              bodyLines: [
                `Your withdrawal of N${Number(withdrawal.amount).toLocaleString()} was successful.`,
                `Reference: ${withdrawal.reference}`,
              ],
            });
          }
        }
      } else {
        console.warn(`⚠️ Withdrawal not found for webhook:`, { id, reference });
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Withdrawal webhook processing error:", err);
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
    const normalizedBankName = (bank_name || "").toLowerCase();
    const isOpay = normalizedBankName.includes("opay");
    const isPalmpay = normalizedBankName.includes("palmpay");

    // Special handling for known fintech banks
    if (is_fintech || isOpay || isPalmpay) {
      if (isOpay) {
        flutterwaveBankCode = "099"; // OPay code
      } else if (isPalmpay) {
        flutterwaveBankCode = "100"; // PalmPay code
      }
      console.log(
        `Attempting fintech verification for ${bank_name || "unknown"} with code: ${flutterwaveBankCode}`
      );
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
        console.log(`✅ Account verified: ${response.data.data.account_name}`);
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
      console.error("❌ Flutterwave verification error:", flutterwaveError.response?.data || flutterwaveError.message);
      
      // Special handling for fintech errors
      if (is_fintech || isOpay || isPalmpay) {
        const fallbackName = bank_name ? `${bank_name} Account Holder` : "Fintech Account Holder";
        return res.json({
          success: true,
          account_name: fallbackName,
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
    console.error("❌ Account verification error:", err);
    
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
  // 🚩 Feature flag: Disable withdrawals during Play Store review
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Withdrawals are temporarily disabled for review.",
    });
  }

  try {
    const userId = req.user.id;
    const { method, bank, accountNumber, accountName, amount } = req.body;
    const biometricProof = String(req.body?.biometricProof || "").trim();
    const transactionPin = String(req.body?.transactionPin || "").trim();

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

    const user = await User.findById(userId).select("+transactionPinHash");
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

    const authCheck = await verifyTransactionAuthorization({
      user,
      expectedAction: "withdraw",
      expectedAmount: numericAmount,
      biometricProof,
      transactionPin,
    });
    if (!authCheck.ok) {
      return res.status(400).json({
        success: false,
        message: authCheck.message,
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

    await sendUserEmail({
      userId: userId,
      type: "withdraw_requested",
      email: user.email,
      subject: "Withdrawal Submitted",
      title: "Withdrawal Request Received",
      bodyLines: [
        `Amount: N${Number(numericAmount).toLocaleString()}`,
        `Account: ${accountNumber} (${bank || method})`,
        `Reference: ${reference}`,
        "We are processing your withdrawal.",
      ],
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
    console.error("❌ WithdrawFunds Error:", err);
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
    console.error("❌ GetWithdrawalHistory Error:", err);
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
    console.error("❌ GetDepositHistory Error:", err);
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
    console.error("❌ Get deposit stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deposit statistics",
    });
  }
};
/* =====================================================
   GET DEPOSIT FEE SETTINGS (USER)
===================================================== */
export const getDepositFeeSettings = async (req, res) => {
  try {
    const settings = await fetchDepositFeeSettings();
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("Get deposit fee settings error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch deposit fee settings" });
  }
};

/* =====================================================
   GET / CREATE FLUTTERWAVE VIRTUAL ACCOUNT (USER)
===================================================== */
export const getFlutterwaveVirtualAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const existing = user.flutterwaveVirtualAccount || {};
    if (existing.accountNumber && existing.bankName) {
      return res.json({
        success: true,
        account: existing,
      });
    }

    const hasBvn = Boolean(String(user.bvn || "").trim());
    const hasNin = Boolean(String(user.nin || "").trim());
    if (!hasBvn && !hasNin) {
      return res.status(400).json({
        success: false,
        message: "Please add your BVN or NIN in profile to enable virtual account deposits.",
      });
    }

    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ success: false, message: "Flutterwave secret key missing" });
    }

    const payload = {
      email: user.email,
      is_permanent: true,
      account_name: user.username || user.email,
      bvn: hasBvn ? user.bvn : undefined,
      nin: !hasBvn && hasNin ? user.nin : undefined,
      tx_ref: `va_${user._id}_${Date.now()}`,
      narration: `BiggiData VA ${user.username || user.email}`,
    };

    const headers = {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    };
    const fwBase = String(process.env.FLUTTERWAVE_API_URL || "https://api.flutterwave.com").replace(/\/+$/, "");
    const fwUrl = fwBase.endsWith("/v3") ? `${fwBase}/virtual-account-numbers` : `${fwBase}/v3/virtual-account-numbers`;
    const directUrl = "https://api.flutterwave.com/v3/virtual-account-numbers";

    let response;
    try {
      response = await axios.post(fwUrl, payload, { headers, timeout: 15000 });
    } catch (err) {
      // If proxy fails or is misconfigured, try Flutterwave directly.
      response = await axios.post(directUrl, payload, { headers, timeout: 15000 });
    }

    const data = response?.data?.data || {};
    if (!data.account_number || !data.bank_name) {
      const message = response?.data?.message || "Failed to create virtual account";
      return res.status(400).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== "production" ? { error: response?.data } : {}),
      });
    }

    const account = {
      provider: "flutterwave",
      accountNumber: String(data.account_number || ""),
      bankName: String(data.bank_name || ""),
      accountName: String(data.account_name || user.username || user.email || ""),
      reference: String(data.flw_ref || data.reference || payload.tx_ref || ""),
      createdAt: new Date(),
      updatedAt: new Date(),
      meta: data,
    };

    user.flutterwaveVirtualAccount = account;
    await user.save();

    return res.json({ success: true, account });
  } catch (error) {
    console.error("Virtual account error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create virtual account",
    });
  }
};

