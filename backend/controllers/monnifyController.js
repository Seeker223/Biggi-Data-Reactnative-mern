import axios from "axios";
import User from "../models/User.js";

const monnifyBase = "https://api.monnify.com";

// ------------------------------------------------------------------
// GET MONNIFY TOKEN
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 1️⃣ CREATE STATIC VIRTUAL ACCOUNT
// ------------------------------------------------------------------
export const createStaticAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

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

    // Store inside user model
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
    console.log("createStaticAccount error:", err.response?.data || err);
    return res.status(500).json({
      success: false,
      msg: "Could not create static account. It will work when Monnify activates your API.",
    });
  }
};

// ------------------------------------------------------------------
// 2️⃣ INITIATE PAYMENT FOR WEBVIEW (OPTION B)
// ------------------------------------------------------------------
export const initiateMonnifyPayment = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    const token = await getMonnifyToken();

    const payload = {
      amount,
      customerName: user.username,
      customerEmail: user.email,
      paymentReference: `${user._id}-${Date.now()}`,
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
      reference: payload.paymentReference,
    });
  } catch (error) {
    console.log("initiateMonnifyPayment error:", error.response?.data || error);
    res.status(500).json({ success: false, msg: "Payment initialization failed" });
  }
};

// ------------------------------------------------------------------
// 3️⃣ WEBHOOK HANDLER (ONLY IN index.js)
// ------------------------------------------------------------------
export const monnifyWebhook = async (req, res) => {
  try {
    res.status(200).json({ received: true });

    const event = req.body.eventType;
    if (event !== "SUCCESSFUL_TRANSACTION") return;

    const data = req.body.eventData;
    const userId = data.paymentReference.split("-")[0];
    const amountPaid = data.amountPaid;

    const token = await getMonnifyToken();
    const verify = await axios.get(
      `${monnifyBase}/api/v2/transactions/${data.transactionReference}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (verify.data.responseBody.paymentStatus !== "PAID") {
      console.log("Payment not confirmed by Monnify");
      return;
    }

    const user = await User.findById(userId);
    if (!user) return;

    user.mainBalance += Number(amountPaid);
    await user.save();

    console.log(`Wallet credited ₦${amountPaid} for ${user.username}`);
  } catch (err) {
    console.log("Webhook Error:", err);
  }
};
