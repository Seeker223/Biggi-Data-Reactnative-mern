// walletController.js
import axios from "axios";
import User from "../models/userModel.js";

const monnifyBase = "https://api.monnify.com";

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

// ------------------------------------------------------------
// CREATE STATIC VIRTUAL ACCOUNT
// ------------------------------------------------------------
export const createStaticAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // If already has account, return it
    if (user.virtualAccount.length > 0) {
      return res.json({ success: true, accounts: user.virtualAccount });
    }

    const token = await getMonnifyToken();

    const payload = {
      accountReference: user._id.toString(),
      accountName: user.username,
      customerEmail: user.email,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      currencyCode: "NGN",
      getAllAvailableBanks: true
    };

    const response = await axios.post(
      `${monnifyBase}/api/v2/bank-transfer/reserved-accounts`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    user.virtualAccount = response.data.responseBody.accounts;
    await user.save();

    res.json({
      success: true,
      accounts: response.data.responseBody.accounts
    });

  } catch (error) {
    console.log("Monnify error:", error);
    res.status(500).json({ success: false, message: "Error creating account" });
  }
};

// ------------------------------------------------------------
// MONNIFY WEBHOOK (Deposit Confirmation)
// ------------------------------------------------------------
export const monnifyWebhook = async (req, res) => {
  try {
    const data = req.body;

    // Only accept successful credit alerts
    if (data.eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.status(200).send("ignored");
    }

    const userId = data.eventData.product.reference;
    const amountPaid = data.eventData.amountPaid;

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    user.mainBalance += Number(amountPaid);
    user.totalDeposits += Number(amountPaid);

    await user.save();

    res.status(200).send("OK");
  } catch (err) {
    console.log("Webhook Error:", err);
    res.status(500).send("Webhook Processing Error");
  }
};
