import sendEmail from "../utils/sendEmail.js";

export const sendTestEmail = async (req, res) => {
  try {
    const targetEmail = String(req.body?.email || "").trim() || null;
    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        message: "email is required",
      });
    }

    const result = await sendEmail({
      email: targetEmail,
      subject: "Test Email from Biggi Data",
      message: "<p>This is a test email to verify SMTP is working.</p>",
    });

    return res.status(200).json({
      success: true,
      message: "Test email sent",
      provider: result?.provider,
      messageId: result?.messageId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to send test email",
    });
  }
};

