import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";
import { logPlatformDepositFee } from "../utils/platformLedger.js";
import { verifyTransactionAuthorization } from "../utils/transactionAuth.js";
import { getDepositFeeSettings, computeDepositFee } from "../utils/depositFee.js";

const extractAccountNumber = (data = {}) =>
  data?.account_number ||
  data?.meta?.account_number ||
  data?.meta?.accountNumber ||
  data?.meta?.virtual_account?.account_number ||
  data?.meta?.static_account?.account_number ||
  data?.customer?.account_number ||
  data?.account?.account_number ||
  data?.account?.number ||
  data?.meta?.account?.account_number;
/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (SDK â†’ BACKEND)
===================================================== */
export const verifyFlutterwavePayment = async (req, res) => {
  let tx_ref; // Declare here for catch block access
  
  try {
    const { tx_ref: txRefFromBody, biometricProof: biometricProofFromBody, transactionPin: txPinFromBody } = req.body;
    tx_ref = txRefFromBody;
    const biometricProof = String(biometricProofFromBody || "").trim();
    const transactionPin = String(txPinFromBody || "").trim();
    const userId = req.user.id;
    const requestedAmount = Number(req.body?.amount || 0);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
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

    const existingDeposit = await Deposit.findOne({ reference: tx_ref, user: userId });
    
    if (existingDeposit && existingDeposit.status === "successful") {
      return res.json({
        success: true,
        message: "Payment already processed",
        tx_ref: payment.tx_ref,
        amount: Number(existingDeposit.amount || payment.amount || 0),
        serviceCharge: Number(existingDeposit.serviceCharge || 0),
        totalAmount: Number(existingDeposit.totalAmount || payment.amount || 0),
        balance: await getCurrentBalance(userId),
      });
    }

    if (payment.status === "successful") {
      const user = await User.findById(userId).select("+transactionPinHash");
      
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const authCheck = await verifyTransactionAuthorization({
        user,
        expectedAction: "deposit",
        expectedAmount: requestedAmount,
        biometricProof,
        transactionPin,
      });
      if (!authCheck.ok) {
        return res.status(400).json({
          success: false,
          message: authCheck.message,
        });
      }

      const feeSettings = await getDepositFeeSettings();
      const paidAmount = Number(payment.amount || 0);
      const serviceCharge = computeDepositFee(paidAmount, feeSettings);
      const creditedAmount = Math.max(0, Math.round(paidAmount - serviceCharge));
      if (Math.round(creditedAmount) !== Math.round(requestedAmount)) {
        return res.status(400).json({
          success: false,
          message: "Payment amount does not match expected credit",
          expectedCredit: requestedAmount,
          computedCredit: creditedAmount,
          paidAmount,
        });
      }

      let deposit;
      if (existingDeposit) {
        existingDeposit.status = "successful";
        existingDeposit.flutterwaveTransactionId = payment.id;
        existingDeposit.gatewayResponse = payment;
        await existingDeposit.save();
        deposit = existingDeposit;
      } else {
        deposit = await Deposit.create({
          user: userId,
          amount: creditedAmount,
          serviceCharge,
          totalAmount: paidAmount,
          reference: tx_ref,
          status: "successful",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        });
      }

      user.mainBalance += Number(creditedAmount);
      user.totalDeposits += Number(creditedAmount);
      await user.save();

      await logWalletTransaction(
        userId,
        "deposit",
        creditedAmount,
        tx_ref,
        "success"
      );

      if (serviceCharge > 0) {
        await logPlatformDepositFee({ userId, reference: tx_ref, revenue: serviceCharge });
      }

      console.log("âœ… Wallet credited via verification API:", tx_ref);

      return res.json({
        success: true,
        message: "Payment verified and wallet credited",
        tx_ref: payment.tx_ref,
        amount: creditedAmount,
        serviceCharge,
        totalAmount: paidAmount,
        balance: user.mainBalance,
      });
    } else {
      await Deposit.findOneAndUpdate(
        { reference: tx_ref },
        {
          user: userId,
          amount: payment.amount || 0,
          reference: tx_ref,
          status: "failed",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        },
        { upsert: true, new: true }
      );

      return res.status(400).json({
        success: false,
        message: `Payment ${payment.status}`,
        tx_ref: payment.tx_ref,
      });
    }
  } catch (err) {
    console.error("Verify error:", err.response?.data || err.message);
    
    if (tx_ref) {
      const deposit = await Deposit.findOne({ reference: tx_ref });
      if (deposit && deposit.status === "successful") {
        const userId = req.user?.id;
        return res.json({
          success: true,
          message: "Payment already processed",
          balance: userId ? await getCurrentBalance(userId) : 0,
        });
      }
    }
    
    return res.status(500).json({ 
      success: false, 
      message: "Verification failed",
      error: err.message 
    });
  }
};

/* =====================================================
   HELPER: GET CURRENT BALANCE
===================================================== */
const getCurrentBalance = async (userId) => {
  try {
    const user = await User.findById(userId).select("mainBalance");
    return user ? user.mainBalance : 0;
  } catch (error) {
    console.error("Balance fetch error:", error);
    return 0;
  }
};

/* =====================================================
   FLUTTERWAVE WEBHOOK (PRIMARY WALLET CREDITING) - FIXED
===================================================== */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    
    // DEBUG LOGGING - Keep for troubleshooting
    console.log("ðŸ“¥ Webhook headers received:", JSON.stringify(req.headers, null, 2));
    
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      console.error("âŒ Invalid webhook signature");
      console.error("Expected:", process.env.FLUTTERWAVE_WEBHOOK_SECRET);
      console.error("Received:", signature);
      return res.sendStatus(401);
    }

    // CRITICAL FIX: Parse raw Buffer correctly
    let payload;
    try {
      // req.body is a Buffer because of express.raw()
      const rawBodyString = req.body.toString('utf8');
      console.log("ðŸ“¥ Raw webhook body:", rawBodyString);
      payload = JSON.parse(rawBodyString);
    } catch (parseError) {
      console.error("âŒ Failed to parse webhook body:", parseError.message);
      console.error("Raw body type:", typeof req.body);
      return res.sendStatus(400);
    }

    const { event, data } = payload;
    
    console.log("âœ… Webhook parsed successfully:", { 
      event, 
      tx_ref: data?.tx_ref,
      status: data?.status,
      amount: data?.amount 
    });

    // Ignore irrelevant events
    if (event !== "charge.completed") {
      console.log(`â„¹ï¸ Ignoring event: ${event}`);
      return res.sendStatus(200);
    }

    const { tx_ref, status, amount, id, currency } = data;
    const accountNumber = extractAccountNumber(data);
    const customerEmail = data?.customer?.email;
    const reference = String(tx_ref || data?.flw_ref || data?.reference || id || "");

    if (!amount) {
      console.error("âŒ Missing amount in webhook");
      return res.sendStatus(200);
    }
    if (!reference && !accountNumber && !customerEmail) {
      console.error("âŒ Missing reference/account/email in webhook payload");
      return res.sendStatus(200);
    }

    // Extract userId from tx_ref format: flw_<USERID>_<timestamp>
    const parts = String(tx_ref || reference || "").split("_");
    let userId = parts[1];

    // If tx_ref isn't in expected format, attempt to resolve by virtual account number or email.
    let virtualAccountUser = null;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      userId = null;
      if (accountNumber) {
        virtualAccountUser = await User.findOne({
          "flutterwaveVirtualAccount.accountNumber": String(accountNumber),
        });
      }
      if (!virtualAccountUser && customerEmail) {
        virtualAccountUser = await User.findOne({ email: String(customerEmail).toLowerCase() });
      }
      if (virtualAccountUser) {
        userId = String(virtualAccountUser._id);
      }
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error("âŒ Invalid user ID in tx_ref and no virtual account match:", tx_ref);
      return res.sendStatus(200);
    }

    const isVirtualAccountPayment = Boolean(accountNumber);

    // Atomic operation to prevent double crediting
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        console.error("âŒ User not found for ID:", userId);
        return res.sendStatus(200);
      }

      const paidAmount = Number(amount || 0);
      if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
        await session.abortTransaction();
        console.error("âŒ Invalid payment amount for webhook:", amount);
        return res.sendStatus(200);
      }
      const reference = String(tx_ref || data?.flw_ref || data?.reference || id || `va_${userId}_${Date.now()}`);

      // Check for existing successful deposit
      const existingDeposit = await Deposit.findOne({
        reference,
        status: "successful",
      }).session(session);

      if (existingDeposit) {
        await session.abortTransaction();
        console.log("âš ï¸ Deposit already processed:", reference);
        return res.sendStatus(200);
      }

      if (isVirtualAccountPayment && status === "successful") {
        const feeSettings = await getDepositFeeSettings();
        const serviceCharge = computeDepositFee(paidAmount, feeSettings);
        const creditedAmount = Math.max(0, Math.round(paidAmount - serviceCharge));

        await Deposit.findOneAndUpdate(
          { reference },
          {
            user: userId,
            amount: creditedAmount,
            serviceCharge,
            totalAmount: paidAmount,
            currency: currency || "NGN",
            reference,
            status: "successful",
            channel: "flutterwave_virtual",
            flutterwaveTransactionId: id,
            gatewayResponse: data,
          },
          { upsert: true, new: true, session }
        );

        user.mainBalance += Number(creditedAmount);
        user.totalDeposits += Number(creditedAmount);
        user.addNotification({
          type: "Deposit",
          status: "success",
          amount: creditedAmount,
          message: `Bank transfer received. Wallet credited with N${creditedAmount.toLocaleString()}.`,
        });
        await user.save({ session });

        await session.commitTransaction();

        try {
          await logWalletTransaction(userId, "deposit", creditedAmount, reference, "success");
          if (serviceCharge > 0) {
            await logPlatformDepositFee({ userId, reference, revenue: serviceCharge });
          }
        } catch (logError) {
          console.error("Wallet log error:", logError);
        }

        console.log("âœ… Virtual account deposit credited:", reference);
        return res.sendStatus(200);
      }

      // Store payment event only; crediting is handled by verify/reconcile endpoint
      await Deposit.findOneAndUpdate(
        { reference },
        {
          user: userId,
          amount: paidAmount,
          currency: currency || "NGN",
          reference,
          status: status === "successful" ? "pending" : "failed",
          channel: "flutterwave",
          flutterwaveTransactionId: id,
          gatewayResponse: data,
        },
        { upsert: true, new: true, session }
      );

      if (status === "successful") {
        console.log("â„¹ï¸ Deposit marked pending auth via webhook:", {
          reference,
          amount: paidAmount,
          currency,
          userId,
        });
      } else {
        console.log("âŒ Payment failed via webhook:", { reference, status });
      }

      await session.commitTransaction();
      console.log("âœ… Webhook transaction committed for:", reference);
    } catch (sessionError) {
      await session.abortTransaction();
      console.error("âŒ Webhook transaction failed:", sessionError);
    } finally {
      session.endSession();
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("ðŸ”¥ Webhook processing error:", err);
    // Always return 200 to prevent Flutterwave from retrying
    return res.sendStatus(200);
  }
};

/* =====================================================
   ENHANCED DEPOSIT STATUS CHECK
===================================================== */
export const getDepositStatus = async (req, res) => {
  try {
    const { tx_ref } = req.params;
    const userId = req.user.id;

    if (!tx_ref) {
      return res.status(400).json({ 
        success: false, 
        message: "Transaction reference required" 
      });
    }

    // Find deposit for this user
    const deposit = await Deposit.findOne({ 
      reference: tx_ref,
      user: userId 
    });

    if (deposit) {
      const user = await User.findById(userId);
      return res.json({ 
        success: true,
        status: deposit.status,
        amount: deposit.amount,
        serviceCharge: deposit.serviceCharge || 0,
        totalAmount: deposit.totalAmount || deposit.amount,
        createdAt: deposit.createdAt,
        balance: user?.mainBalance || 0
      });
    }

    // If no deposit record exists, check with Flutterwave for display only (no auto-credit)
    try {
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
          timeout: 10000,
        }
      );

      const payment = response.data?.data;
      
      if (payment && payment.status === "successful") {
        const feeSettings = await getDepositFeeSettings();
        const paidAmount = Number(payment.amount || 0);
        const serviceCharge = computeDepositFee(paidAmount, feeSettings);
        const creditedAmount = Math.max(0, Math.round(paidAmount - serviceCharge));

        await Deposit.findOneAndUpdate(
          { reference: tx_ref },
          {
            user: userId,
            amount: creditedAmount,
            serviceCharge,
            totalAmount: paidAmount,
            reference: tx_ref,
            status: "pending",
            channel: "flutterwave",
            flutterwaveTransactionId: payment.id,
            gatewayResponse: payment,
          },
          { upsert: true, new: true }
        );

        return res.json({
          success: true,
          status: "pending",
          amount: creditedAmount,
          serviceCharge,
          totalAmount: paidAmount,
          message: "Payment received. Authorization required to credit wallet.",
          balance: 0,
        });
      } else if (payment) {
        const paidAmount = Number(payment.amount || 0);
        return res.json({ 
          success: true,
          status: payment.status || "pending",
          amount: paidAmount,
          serviceCharge: 0,
          totalAmount: paidAmount,
          balance: 0
        });
      }
    } catch (verifyError) {
      console.log("Auto-verify failed:", verifyError.message);
    }
    
    return res.json({ 
      success: true,
      status: "pending",
      balance: 0
    });
  } catch (error) {
    console.error("Deposit status error:", error);
    return res.status(500).json({ 
      success: false,
      status: "error",
      message: "Failed to check deposit status" 
    });
  }
};

/* =====================================================
   MANUAL PAYMENT RECONCILIATION
===================================================== */
export const reconcilePayment = async (req, res) => {
  try {
    const { tx_ref, biometricProof: biometricProofFromBody, transactionPin: txPinFromBody } = req.body;
    const biometricProof = String(biometricProofFromBody || "").trim();
    const transactionPin = String(txPinFromBody || "").trim();
    const userId = req.user.id;
    const requestedAmount = Number(req.body?.amount || 0);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
    }

    const existingDeposit = await Deposit.findOne({
      reference: tx_ref,
      user: userId,
    });

    if (existingDeposit && existingDeposit.status === "successful") {
      return res.json({
        success: true,
        message: "Payment already processed",
        tx_ref: payment.tx_ref,
        amount: Number(existingDeposit.amount || payment.amount || 0),
        serviceCharge: Number(existingDeposit.serviceCharge || 0),
        totalAmount: Number(existingDeposit.totalAmount || payment.amount || 0),
        balance: await getCurrentBalance(userId),
      });
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
        message: "Payment not found",
      });
    }

    if (payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: `Payment is ${payment.status}`,
        status: payment.status,
      });
    }

    const user = await User.findById(userId).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const authCheck = await verifyTransactionAuthorization({
      user,
      expectedAction: "deposit",
      expectedAmount: Number(payment.amount || 0),
      biometricProof,
      transactionPin,
    });
    if (!authCheck.ok) {
      return res.status(400).json({
        success: false,
        message: authCheck.message,
      });
    }

    const feeSettings = await getDepositFeeSettings();
    const serviceCharge = computeDepositFee(requestedAmount, feeSettings);
    const expectedTotal = Number(requestedAmount) + Number(serviceCharge || 0);
    const paidAmount = Number(payment.amount || 0);
    if (Math.round(paidAmount) !== Math.round(expectedTotal)) {
      return res.status(400).json({
        success: false,
        message: "Payment amount does not match expected total",
        expectedTotal,
        paidAmount,
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const deposit = await Deposit.findOneAndUpdate(
        { reference: tx_ref },
        {
          user: userId,
          amount: requestedAmount,
          serviceCharge,
          totalAmount: paidAmount,
          reference: tx_ref,
          status: "successful",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        },
        { upsert: true, new: true, session }
      );

      const previousBalance = user.mainBalance;
      user.mainBalance += Number(requestedAmount);
      user.totalDeposits += Number(requestedAmount);
      await user.save({ session });

      await session.commitTransaction();

      try {
        await logWalletTransaction(
          userId,
          "deposit",
          requestedAmount,
          tx_ref,
          "success"
        );

        if (serviceCharge > 0) {
          await logPlatformDepositFee({ userId, reference: tx_ref, revenue: serviceCharge });
        }
      } catch (logError) {
        console.error("Wallet log error:", logError);
      }

      console.log("âœ… Manual reconciliation successful:", {
        tx_ref,
        amount: requestedAmount,
          serviceCharge,
          totalAmount: paidAmount,
        previousBalance,
        newBalance: user.mainBalance,
      });

      return res.json({
        success: true,
        message: "Payment reconciled successfully",
        balance: user.mainBalance,
        deposit: {
          id: deposit._id,
          amount: deposit.amount,
          serviceCharge: deposit.serviceCharge || 0,
          totalAmount: deposit.totalAmount || deposit.amount,
          status: deposit.status,
          createdAt: deposit.createdAt,
        },
      });
    } catch (txError) {
      await session.abortTransaction();
      throw txError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Reconciliation error:", error);
    
    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        message: `Flutterwave API error: ${error.response.status}`,
        error: error.response.data?.message || "API request failed",
      });
    }
    
    return res.status(500).json({
      success: false,
      message: "Reconciliation failed",
      error: error.message,
    });
  }
};

















