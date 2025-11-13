import express from "express";
import sendEmail from "../utils/sendEmail.js";

const router = express.Router();

// 🔥 TEST EMAIL ROUTE
export const testEmail= async (req, res) => {
  try {
    const { email } = req.body;

    await sendEmail({
      email,
      subject: "✅ Test Email from Biggi Data",
      message: "This is a successful test email using Nodemailer + Gmail SMTP.",
    });

    res.status(200).json({ success: true, message: "Test email sent successfully!" });
  } catch (error) {
    console.error("Test Email Error:", error);
    res.status(500).json({ success: false, error: "Failed to send test email." });
  }
};

export default router;
