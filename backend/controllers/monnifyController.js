import axios from "axios";
import User from "../models/User.js";

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
   1. CREATE STATIC MONNIFY ACCOUNT
----------------------------------------------------------- */
export const createStaticAccount = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const user = await User.findById(req.user.id);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    // Don't create duplicate static accounts
    if (
      user.monnifyVirtualAccount &&
      user.monnifyVirtualAccount.accountNumber
    ) {
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

    const paymentReference = `${user._id}-${Date.now()}`;

    const payload = {
      amount,
      customerName: user.username,
      customerEmail: user.email,
      paymentReference,
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
      reference: paymentReference,
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
   3. MONNIFY WEBHOOK (index.js must use raw body)
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

    // Verify from monnify
    const verify = await axios.get(
      `${monnifyBase}/api/v2/transactions/${data.transactionReference}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (verify.data.responseBody.paymentStatus !== "PAID") {
      console.log("❌ Payment not confirmed by Monnify");
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log("❌ User not found for payment");
      return;
    }

    // CREDIT WALLET
    user.mainBalance = Number(user.mainBalance) + amountPaid;
    user.totalDeposits = Number(user.totalDeposits) + amountPaid;

    await user.save();

    console.log(
      `✅ Wallet credited ₦${amountPaid} for ${user.username}. New balance: ₦${user.mainBalance}`
    );
  } catch (err) {
    console.log("Webhook ERROR:", err);
  }
};
