//backend/controllers/flutterwaveController.js
import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";
import { verifyTransactionAuthorization } from "../utils/transactionAuth.js";

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

    const existingDeposit = await Deposit.findOne({ reference: tx_ref });
    
    if (existingDeposit && existingDeposit.status === "successful") {
      return res.json({
        success: true,
        message: "Payment already processed",
        tx_ref: payment.tx_ref,
        amount: payment.amount,
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
        return res.status(401).json({
          success: false,
          message: authCheck.message,
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
          amount: payment.amount,
          reference: tx_ref,
          status: "successful",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        });
      }

      user.mainBalance += Number(payment.amount);
      user.totalDeposits += Number(payment.amount);
      await user.save();

      await logWalletTransaction(
        userId,
        "deposit",
        payment.amount,
        tx_ref,
        "success"
      );

      console.log("✅ Wallet credited via verification API:", tx_ref);
      
      return res.json({
        success: true,
        message: "Payment verified and wallet credited",
        tx_ref: payment.tx_ref,
        amount: payment.amount,
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
    console.log("📥 Webhook headers received:", JSON.stringify(req.headers, null, 2));
    
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      console.error("❌ Invalid webhook signature");
      console.error("Expected:", process.env.FLUTTERWAVE_WEBHOOK_SECRET);
      console.error("Received:", signature);
      return res.sendStatus(401);
    }

    // CRITICAL FIX: Parse raw Buffer correctly
    let payload;
    try {
      // req.body is a Buffer because of express.raw()
      const rawBodyString = req.body.toString('utf8');
      console.log("📥 Raw webhook body:", rawBodyString);
      payload = JSON.parse(rawBodyString);
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
      amount: data?.amount 
    });

    // Ignore irrelevant events
    if (event !== "charge.completed") {
      console.log(`ℹ️ Ignoring event: ${event}`);
      return res.sendStatus(200);
    }

    const { tx_ref, status, amount, id, currency } = data;

    if (!tx_ref || !amount) {
      console.error("❌ Missing tx_ref or amount in webhook");
      return res.sendStatus(200);
    }

    // Extract userId from tx_ref format: flw_<USERID>_<timestamp>
    const parts = tx_ref.split("_");
    const userId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error("❌ Invalid user ID in tx_ref:", tx_ref);
      return res.sendStatus(200);
    }

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
        reference: tx_ref,
        status: "successful",
      }).session(session);

      if (existingDeposit) {
        await session.abortTransaction();
        console.log("⚠️ Deposit already processed:", tx_ref);
        return res.sendStatus(200);
      }

      // Create deposit record
      await Deposit.findOneAndUpdate(
        { reference: tx_ref },
        {
          user: userId,
          amount,
          currency: currency || "NGN",
          reference: tx_ref,
          status: status === "successful" ? "successful" : "failed",
          channel: "flutterwave",
          flutterwaveTransactionId: id,
          gatewayResponse: data,
        },
        { upsert: true, new: true, session }
      );

      // Credit wallet only for successful payments
      if (status === "successful") {
        const previousBalance = user.mainBalance;
        user.mainBalance += Number(amount);
        user.totalDeposits += Number(amount);
        await user.save({ session });

        // Log wallet transaction
        try {
          await logWalletTransaction(
            userId,
            "deposit",
            amount,
            tx_ref,
            "success"
          );
        } catch (logError) {
          console.error("Wallet log error (non-critical):", logError);
        }

        console.log("✅ Wallet credited via webhook:", {
          tx_ref,
          amount,
          currency,
          previousBalance,
          newBalance: user.mainBalance,
          userId,
        });
      } else {
        console.log("❌ Payment failed via webhook:", { tx_ref, status });
      }

      await session.commitTransaction();
      console.log("✅ Webhook transaction committed for:", tx_ref);
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
        createdAt: deposit.createdAt,
        balance: user?.mainBalance || 0
      });
    }

    // If no deposit record exists, check with Flutterwave
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
        const user = await User.findById(userId);
        if (user) {
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            await Deposit.create([{
              user: userId,
              amount: payment.amount,
              reference: tx_ref,
              status: "successful",
              channel: "flutterwave",
              flutterwaveTransactionId: payment.id,
              gatewayResponse: payment,
            }], { session });

            user.mainBalance += Number(payment.amount);
            user.totalDeposits += Number(payment.amount);
            await user.save({ session });

            await session.commitTransaction();

            // Log transaction
            try {
              await logWalletTransaction(
                userId,
                "deposit",
                payment.amount,
                tx_ref,
                "success"
              );
            } catch (logError) {
              console.error("Wallet log error:", logError);
            }

            return res.json({ 
              success: true,
              status: "successful",
              amount: payment.amount,
              balance: user.mainBalance 
            });
          } catch (txError) {
            await session.abortTransaction();
            throw txError;
          } finally {
            session.endSession();
          }
        }
      } else if (payment) {
        return res.json({ 
          success: true,
          status: payment.status || "pending",
          amount: payment.amount,
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

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
    }

    const existingDeposit = await Deposit.findOne({
      reference: tx_ref,
      user: userId,
    });

    if (existingDeposit && existingDeposit.status === "successful") {
      const user = await User.findById(userId);
      return res.json({
        success: true,
        message: "Payment already processed",
        balance: user?.mainBalance || 0,
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
      return res.status(401).json({
        success: false,
        message: authCheck.message,
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const deposit = await Deposit.findOneAndUpdate(
        { reference: tx_ref },
        {
          user: userId,
          amount: payment.amount,
          reference: tx_ref,
          status: "successful",
          channel: "flutterwave",
          flutterwaveTransactionId: payment.id,
          gatewayResponse: payment,
        },
        { upsert: true, new: true, session }
      );

      const previousBalance = user.mainBalance;
      user.mainBalance += Number(payment.amount);
      user.totalDeposits += Number(payment.amount);
      await user.save({ session });

      await session.commitTransaction();

      try {
        await logWalletTransaction(
          userId,
          "deposit",
          payment.amount,
          tx_ref,
          "success"
        );
      } catch (logError) {
        console.error("Wallet log error:", logError);
      }

      console.log("✅ Manual reconciliation successful:", {
        tx_ref,
        amount: payment.amount,
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
