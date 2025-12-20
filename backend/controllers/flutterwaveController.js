import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import { logWalletTransaction } from "../utils/wallet.js";

/* =====================================================
   VERIFY FLUTTERWAVE PAYMENT (SDK → BACKEND)
   - Now handles both verification AND wallet crediting
   - Acts as fallback for failed webhooks
===================================================== */
export const verifyFlutterwavePayment = async (req, res) => {
  let tx_ref; // Declare here for catch block access
  
  try {
    const { tx_ref: txRefFromBody } = req.body;
    tx_ref = txRefFromBody; // Assign to outer variable
    const userId = req.user.id;

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
    }

    // Verify payment with Flutterwave
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

    // Check if already processed
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

    // Handle successful payment
    if (payment.status === "successful") {
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Create or update deposit record
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

      // Credit wallet
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
      // Handle failed/cancelled payment
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
    
    // Even if verification fails, check if deposit exists
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
   FLUTTERWAVE WEBHOOK (PRIMARY WALLET CREDITING)
===================================================== */
export const flutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];

    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
      console.error("❌ Invalid webhook signature");
      return res.sendStatus(401);
    }

    // Parse payload - handle both string and object formats
    let event, data;
    if (typeof req.body === "string") {
      try {
        const parsed = JSON.parse(req.body);
        event = parsed.event;
        data = parsed.data;
      } catch (parseError) {
        console.error("❌ Failed to parse webhook body:", parseError);
        return res.sendStatus(400);
      }
    } else if (typeof req.body === "object") {
      event = req.body.event;
      data = req.body.data;
    } else {
      console.error("❌ Invalid webhook body type:", typeof req.body);
      return res.sendStatus(400);
    }

    console.log("📥 Webhook received:", { event, tx_ref: data?.tx_ref });

    // Ignore irrelevant events
    if (event !== "charge.completed") {
      return res.sendStatus(200);
    }

    const { tx_ref, status, amount, id } = data;

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
        user.mainBalance += Number(amount);
        user.totalDeposits += Number(amount);
        await user.save({ session });

        // Log outside transaction to avoid failures
        setTimeout(async () => {
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
        }, 0);

        console.log("✅ Wallet credited via webhook:", {
          tx_ref,
          amount,
          newBalance: user.mainBalance,
        });
      } else {
        console.log("❌ Payment failed:", { tx_ref, status });
      }

      await session.commitTransaction();
      console.log("✅ Webhook transaction committed for:", tx_ref);
    } catch (sessionError) {
      await session.abortTransaction();
      console.error("❌ Webhook transaction failed:", sessionError);
      // Don't throw - return 200 to prevent Flutterwave retries
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
          timeout: 10000, // 10 second timeout
        }
      );

      const payment = response.data?.data;
      
      if (payment && payment.status === "successful") {
        // Auto-process successful payment
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
            setTimeout(async () => {
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
            }, 0);

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
        // Payment exists but not successful
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
    
    // Default to pending
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
    const { tx_ref } = req.body;
    const userId = req.user.id;

    if (!tx_ref) {
      return res.status(400).json({ success: false, message: "tx_ref required" });
    }

    // Check if already processed
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

    // Verify with Flutterwave
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

    // Process payment
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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

      user.mainBalance += Number(payment.amount);
      user.totalDeposits += Number(payment.amount);
      await user.save({ session });

      await session.commitTransaction();

      // Log wallet transaction (non-critical)
      setTimeout(async () => {
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
      }, 0);

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
    
    // Check if it's an axios error
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