// controllers/monnifyController.js
import axios from "axios";
import User from "../models/User.js";
import Deposit from "../models/Deposit.js"; // Ensure this model exists
import { logWalletTransaction } from "../utils/wallet.js";

const monnifyBase = process.env.MONNIFY_BASE_URL;

/* -----------------------------------------------------------
   0. GET MONNIFY TOKEN
----------------------------------------------------------- */
const getMonnifyToken = async () => {
  const auth = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  const res = await axios.post(
    `${monnifyBase}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return res.data.responseBody.accessToken;
};

/* -----------------------------------------------------------
   1. CREATE STATIC VIRTUAL ACCOUNT (for Bank Transfer Deposits)
----------------------------------------------------------- */
export const createStaticAccount = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    if (user.monnifyVirtualAccount?.accountNumber) {
      return res.json({
        success: true,
        accountNumber: user.monnifyVirtualAccount.accountNumber,
        bankName: user.monnifyVirtualAccount.bankName,
      });
    }

    const token = await getMonnifyToken();

    const payload = {
      accountReference: user._id.toString(),
      accountName: user.username,
      customerName: user.username,
      customerEmail: user.email,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      currencyCode: "NGN",
    };

    const response = await axios.post(
      `${monnifyBase}/api/v2/bank-transfer/reserved-accounts`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const acct = response.data.responseBody;

    user.monnifyVirtualAccount = {
      accountNumber: acct.accountNumber,
      bankName: acct.bankName,
    };

    await user.save();

    return res.json({
      success: true,
      accountNumber: acct.accountNumber,
      bankName: acct.bankName,
    });
  } catch (err) {
    console.log("createStaticAccount ERROR:", err.response?.data || err);

    return res.status(500).json({
      success: false,
      msg: "Monnify static account creation failed. Wait for activation.",
    });
  }
};

/* -----------------------------------------------------------
   2. INITIATE WEBVIEW PAYMENT
----------------------------------------------------------- */
export const initiateMonnifyPayment = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 100)
      return res.status(400).json({
        success: false,
        msg: "Amount must be at least ₦100",
      });

    const user = await User.findById(req.user.id);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    const token = await getMonnifyToken();

    const reference = `${user._id}-${Date.now()}`;

    // Save pending deposit record
    await Deposit.create({
      user: user._id,
      amount,
      reference,
      status: "pending",
      channel: "monnify-webview",
    });

    const payload = {
      amount,
      customerName: user.username,
      customerEmail: user.email,
      paymentReference: reference,
      paymentDescription: "Wallet Funding - Biggi Data",
      currencyCode: "NGN",
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      redirectUrl: "https://webhook.site/redirect-test",
    };

    const response = await axios.post(
      `${monnifyBase}/api/v1/merchant/transactions/init-transaction`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.json({
      success: true,
      checkoutUrl: response.data.responseBody.checkoutUrl,
      reference,
    });
  } catch (error) {
    console.log("initiateMonnifyPayment ERROR:", error.response?.data || error);
    res.status(500).json({
      success: false,
      msg: "Payment initialization failed",
    });
  }
};

/* -----------------------------------------------------------
   3. MONNIFY WEBHOOK
   (index.js must use raw body middleware)
----------------------------------------------------------- */
export const monnifyWebhook = async (req, res) => {
  try {
    res.status(200).json({ received: true });

    const eventType = req.body.eventType;
    if (eventType !== "SUCCESSFUL_TRANSACTION") return;

    const data = req.body.eventData;

    const userId = data.paymentReference.split("-")[0];
    const amountPaid = Number(data.amountPaid);

    const token = await getMonnifyToken();

    const verify = await axios.get(
      `${monnifyBase}/api/v2/transactions/${data.transactionReference}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (verify.data.responseBody.paymentStatus !== "PAID") {
      console.log("❌ Payment not confirmed by Monnify");
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log("❌ User not found");
      return;
    }

    // Check if already processed
    const existing = await Deposit.findOne({ reference: data.paymentReference });
    if (existing && existing.status === "successful") {
      console.log("⚠ Payment already credited.");
      return;
    }

    // Credit user
    user.mainBalance += amountPaid;
    user.totalDeposits += amountPaid;
    await user.save();

    await Deposit.findOneAndUpdate(
      { reference: data.paymentReference },
      { status: "successful" }
    );

    await logWalletTransaction(
      user._id,
      "deposit",
      amountPaid,
      data.paymentReference,
      "success"
    );

    console.log(
      `✅ Wallet credited ₦${amountPaid} for ${user.username}. New balance: ₦${user.mainBalance}`
    );
  } catch (err) {
    console.log("Webhook ERROR:", err.response?.data || err);
  }
};

/* -----------------------------------------------------------
   4. PAYMENT STATUS POLLING (automatic fallback)
----------------------------------------------------------- */

// Called repeatedly from cron or server interval
export const pollPendingMonnifyDeposits = async () => {
  try {
    const pending = await Deposit.find({ status: "pending" }).limit(20);

    if (!pending.length) return;

    const token = await getMonnifyToken();

    for (const dep of pending) {
      try {
        const verify = await axios.get(
          `${monnifyBase}/api/v2/transactions/${dep.reference}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const paymentStatus = verify.data.responseBody?.paymentStatus;

        if (paymentStatus === "PAID") {
          const user = await User.findById(dep.user);

          if (!user) continue;

          user.mainBalance += dep.amount;
          user.totalDeposits += dep.amount;
          await user.save();

          dep.status = "successful";
          await dep.save();

          await logWalletTransaction(
            user._id,
            "deposit",
            dep.amount,
            dep.reference,
            "success"
          );

          console.log(
            `🔁 POLL CREDITED ₦${dep.amount} (ref: ${dep.reference})`
          );
        }
      } catch (err) {
        console.log("Poll error:", err.response?.data || err);
      }
    }
  } catch (err) {
    console.log("Global Poll ERROR:", err);
  }
};

/* -----------------------------------------------------------
   5. Start Polling Every 30 Seconds
----------------------------------------------------------- */
setInterval(() => {
  pollPendingMonnifyDeposits();
}, 30000);
