import User from "../models/User.js";
import { zenipointRequest, generateReference } from "../utils/zenipoint.js";

export const buyData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { network, planId, amount, phone } = req.body;

    if (!network || !planId || !amount || !phone)
      return res.status(400).json({ success: false, msg: "Missing fields" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    if (user.mainBalance < amount) {
      return res.status(400).json({ success: false, msg: "Insufficient balance" });
    }

    // Deduct first (wallet debit)
    user.mainBalance -= amount;
    await user.save();

    const reference = generateReference();

    const payload = {
      mobile_no: phone,
      plan_id: planId,
      reference,
    };

    const response = await zenipointRequest.post("/data", payload);

    const data = response.data;

    // Zenipoint success
    if (data.status === "success" || data.code === 200) {
      return res.status(200).json({
        success: true,
        msg: data.message || "Data purchase successful",
        reference,
      });
    }

    // ❌ FAILED → Refund balance
    user.mainBalance += amount;
    await user.save();

    return res.status(400).json({
      success: false,
      msg: data.message || "Transaction failed",
    });

  } catch (error) {
    console.log("ZENIPOINT ERROR:", error.response?.data || error.message);

    // Refund on crash/failure
    const user = await User.findById(req.user.id);
    if (user) {
      user.mainBalance += req.body.amount;
      await user.save();
    }

    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
    });
  }
};
