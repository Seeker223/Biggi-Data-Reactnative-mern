import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import WebhookHealth from "../models/WebhookHealth.js";
import { logWalletTransaction } from "../utils/wallet.js";
import { logPlatformDepositFee } from "../utils/platformLedger.js";
import { verifyTransactionAuthorization } from "../utils/transactionAuth.js";
import { getDepositFeeSettings, computeDepositFee } from "../utils/depositFee.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";
/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (SDK → BACKEND)
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
          amount: requestedAmount,
          serviceCharge,
          totalAmount: paidAmount,
          reference: tx_ref,
          status: "successful",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        });
      }

      user.mainBalance += Number(requestedAmount);
      user.totalDeposits += Number(requestedAmount);
      await user.save();

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

      await sendUserEmail({
        userId,
        type: "deposit",
        email: user.email,
        subject: "Deposit Successful",
        title: "Deposit Successful",
        bodyLines: [
          "Your deposit has been credited to your wallet.",
          `Amount credited: ${formatNaira(requestedAmount)}.`,
          `Service charge: ${formatNaira(serviceCharge || 0)}.`,
          `Total paid: ${formatNaira(paidAmount)}.`,
          `Reference: ${tx_ref}.`,
        ],
      });

      console.log("✅ Wallet credited via verification API:", tx_ref);

      return res.json({
        success: true,
        message: "Payment verified and wallet credited",
        tx_ref: payment.tx_ref,
        amount: requestedAmount,
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

const deriveWalletCreditFromTotal = (totalAmount, feeSettings) => {
  const total = Number(totalAmount || 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!feeSettings || feeSettings.enabled === false) return Math.round(total);

  const flat = Number(feeSettings.flatFee || 0);
  const pct = Number(feeSettings.percentFee || 0);

  if (pct <= 0) {
    return Math.max(0, Math.round(total - flat));
  }

  let estimate = Math.max(0, Math.round((total - flat) / (1 + pct / 100)));
  for (let i = 0; i < 3; i += 1) {
    const fee = computeDepositFee(estimate, feeSettings);
    const recomputed = Math.max(0, Math.round(total - fee));
    if (recomputed === estimate) break;
    estimate = recomputed;
  }

  return Math.max(0, estimate);
};

const formatNaira = (value) => `N${Number(value || 0).toLocaleString()}`;
/* =====================================================
   FLUTTERWAVE WEBHOOK (PRIMARY WALLET CREDITING) - FIXED
===================================================== */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    const debugEnabled =
      process.env.NODE_ENV !== "production" ||
      String(process.env.ENABLE_DEBUG_ROUTES || "false").toLowerCase() === "true";
    const allowDebugBypass = debugEnabled && String(req.query?.debug || "") === "1";

    // DEBUG LOGGING - Keep for troubleshooting
    console.log("📥 Webhook headers received:", JSON.stringify(req.headers, null, 2));

    if (!allowDebugBypass) {
      if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
        console.error("❌ Invalid webhook signature");
        console.error("Expected:", process.env.FLUTTERWAVE_WEBHOOK_SECRET);
        console.error("Received:", signature);
        return res.sendStatus(401);
      }
    } else {
      console.log("🧪 Webhook debug bypass enabled");
    }

    // Parse raw Buffer correctly (or accept JSON in debug)
    let payload;
    try {
      if (Buffer.isBuffer(req.body)) {
        const rawBodyString = req.body.toString("utf8");
        console.log("📥 Raw webhook body:", rawBodyString);
        payload = JSON.parse(rawBodyString);
      } else if (typeof req.body === "string") {
        payload = JSON.parse(req.body);
      } else if (req.body && typeof req.body === "object") {
        payload = req.body;
      } else {
        throw new Error("Unsupported webhook body");
      }
    } catch (parseError) {
      console.error("❌ Failed to parse webhook body:", parseError.message);
      console.error("Raw body type:", typeof req.body);
      return res.sendStatus(400);
    }

    const { event, data } = payload;

    console.log("✅ Webhook parsed successfully:", {
      event,
      tx_ref: data?.tx_ref,
      status: data?.status,
      amount: data?.amount,
    });

    try {
      await WebhookHealth.create({
        provider: "flutterwave",
        event: event || "",
        reference: data?.tx_ref || data?.reference || "",
        amount: Number(data?.amount || 0),
        accountNumber:
          data?.meta?.virtual_account?.account_number ||
          data?.meta?.account_number ||
          data?.account_number ||
          "",
        customerEmail: data?.customer?.email || "",
        status: data?.status || "",
        raw: payload,
      });
    } catch (healthError) {
      console.error("⚠️ WebhookHealth write failed:", healthError.message);
    }

    // Ignore irrelevant events
    if (event !== "charge.completed") {
      console.log(`ℹ️ Ignoring event: ${event}`);
      return res.sendStatus(200);
    }

    const { tx_ref, status, amount, id, currency } = data || {};
    const reference = String(
      tx_ref ||
        data?.reference ||
        data?.flw_ref ||
        data?.flwRef ||
        data?.FlwRef ||
        data?.id ||
        ""
    ).trim();

    if (!reference || !amount) {
      console.error("❌ Missing reference or amount in webhook");
      return res.sendStatus(200);
    }

    const accountNumber =
      data?.meta?.virtual_account?.account_number ||
      data?.meta?.account_number ||
      data?.account_number ||
      data?.accountNumber ||
      "";

    const accountId =
      data?.account_id ||
      data?.accountId ||
      data?.AccountId ||
      data?.account?.id ||
      "";

    const resolveUserIdFromRef = (ref) => {
      const parts = String(ref || "").split("_");
      const candidate = parts.find((part) => mongoose.Types.ObjectId.isValid(part));
      return candidate || null;
    };

    let userId = resolveUserIdFromRef(reference);

    if (!userId && accountNumber) {
      const userByAccount = await User.findOne({
        "flutterwaveVirtualAccount.accountNumber": accountNumber,
      }).select("_id");
      userId = userByAccount?._id?.toString() || null;
    }

    if (!userId && accountId) {
      const userByAccountId = await User.findOne({
        $or: [
          { "flutterwaveVirtualAccount.meta.account_id": accountId },
          { "flutterwaveVirtualAccount.meta.accountId": accountId },
          { "flutterwaveVirtualAccount.meta.AccountId": accountId },
          { "flutterwaveVirtualAccount.meta.id": accountId },
        ],
      }).select("_id");
      userId = userByAccountId?._id?.toString() || null;
    }

    if (!userId && data?.customer?.email) {
      const userByEmail = await User.findOne({
        email: String(data.customer.email).toLowerCase(),
      }).select("_id");
      userId = userByEmail?._id?.toString() || null;
    }

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.error("❌ Unable to resolve user for webhook:", { reference, accountNumber });
      return res.sendStatus(200);
    }

    let walletCredit = 0;
    let serviceCharge = 0;
    const totalPaid = Number(amount || 0);

    // Atomic operation to prevent double crediting
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        console.error("❌ User not found for ID:", userId);
        return res.sendStatus(200);
      }

      // Check for existing successful deposit
      const existingDeposit = await Deposit.findOne({
        reference,
        status: "successful",
      }).session(session);

      if (existingDeposit) {
        await session.abortTransaction();
        console.log("⚠️ Deposit already processed:", reference);
        return res.sendStatus(200);
      }

      const feeSettings = await getDepositFeeSettings();
      walletCredit = deriveWalletCreditFromTotal(totalPaid, feeSettings);
      serviceCharge = Math.max(0, Math.round(totalPaid - walletCredit));

      if (walletCredit <= 0) {
        await session.abortTransaction();
        console.log("⚠️ Unable to derive wallet credit from payment:", {
          reference,
          totalPaid,
        });
        return res.sendStatus(200);
      }

      await Deposit.findOneAndUpdate(
        { reference },
        {
          user: userId,
          amount: walletCredit,
          serviceCharge,
          totalAmount: totalPaid,
          currency: currency || "NGN",
          reference,
          status: status === "successful" ? "successful" : "failed",
          channel: "flutterwave",
          flutterwaveTransactionId: id,
          gatewayResponse: data,
        },
        { upsert: true, new: true, session }
      );

      if (status === "successful") {
        user.mainBalance = Number(user.mainBalance || 0) + walletCredit;
        user.totalDeposits = Number(user.totalDeposits || 0) + walletCredit;
        await user.save({ session });
        console.log("✅ Wallet credited via webhook:", {
          reference,
          walletCredit,
          serviceCharge,
          userId,
        });
      } else {
        console.log("❌ Payment failed via webhook:", { reference, status });
      }

      await session.commitTransaction();
      console.log("✅ Webhook transaction committed for:", reference);

      if (status === "successful") {
        await logWalletTransaction(
          userId,
          "deposit",
          walletCredit,
          reference,
          "success"
        );

        if (serviceCharge > 0) {
          await logPlatformDepositFee({
            userId,
            reference,
            revenue: serviceCharge,
          });
        }

        await sendUserEmail({
          userId,
          type: "deposit",
          email: user.email,
          subject: "Deposit Successful",
          title: "Deposit Successful",
          bodyLines: [
            "Your deposit has been credited to your wallet.",
            `Amount credited: ${formatNaira(walletCredit)}.`,
            `Service charge: ${formatNaira(serviceCharge || 0)}.`,
            `Total paid: ${formatNaira(totalPaid)}.`,
            `Reference: ${reference}.`,
          ],
        });
      }
    } catch (sessionError) {
      await session.abortTransaction();
      console.error("❌ Webhook transaction failed:", sessionError);
    } finally {
      session.endSession();
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook processing error:", err);
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
        await Deposit.findOneAndUpdate(
          { reference: tx_ref },
          {
            user: userId,
            amount: requestedAmount,
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
          amount: requestedAmount,
          serviceCharge,
          totalAmount: paidAmount,
          message: "Payment received. Authorization required to credit wallet.",
          balance: 0,
        });
      } else if (payment) {
        return res.json({ 
          success: true,
          status: payment.status || "pending",
          amount: requestedAmount,
          serviceCharge,
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

        await sendUserEmail({
          userId,
          type: "deposit",
          email: user.email,
          subject: "Deposit Successful",
          title: "Deposit Successful",
          bodyLines: [
            "Your deposit has been credited to your wallet.",
            `Amount credited: ${formatNaira(requestedAmount)}.`,
            `Service charge: ${formatNaira(serviceCharge || 0)}.`,
            `Total paid: ${formatNaira(paidAmount)}.`,
            `Reference: ${tx_ref}.`,
          ],
        });
      } catch (logError) {
        console.error("Wallet log error:", logError);
      }

      console.log("✅ Manual reconciliation successful:", {
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

























