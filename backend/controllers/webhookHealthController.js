import WebhookHealth from "../models/WebhookHealth.js";

export const getWebhookHealth = async (req, res) => {
  try {
    const latest = await WebhookHealth.findOne({ provider: "flutterwave" })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({
      success: true,
      latest: latest || null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load webhook health",
      error: error.message,
    });
  }
};
