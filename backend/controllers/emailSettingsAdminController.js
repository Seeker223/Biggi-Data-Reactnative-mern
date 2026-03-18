import EmailSettings from "../models/EmailSettings.js";

const DEFAULTS = {
  enabled: true,
  rateLimitPerHour: 20,
  perType: {},
};

export const getEmailSettings = async (req, res) => {
  try {
    let settings = await EmailSettings.findOne({});
    if (!settings) {
      settings = await EmailSettings.create(DEFAULTS);
    }
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load email settings",
      error: error.message,
    });
  }
};

export const updateEmailSettings = async (req, res) => {
  try {
    const payload = req.body || {};
    let settings = await EmailSettings.findOne({});
    if (!settings) {
      settings = await EmailSettings.create(DEFAULTS);
    }
    settings.enabled = payload.enabled !== undefined ? Boolean(payload.enabled) : settings.enabled;
    if (payload.rateLimitPerHour !== undefined) {
      const n = Number(payload.rateLimitPerHour);
      settings.rateLimitPerHour = Number.isFinite(n) && n > 0 ? n : DEFAULTS.rateLimitPerHour;
    }
    settings.perType =
      payload.perType && typeof payload.perType === "object"
        ? payload.perType
        : settings.perType;

    await settings.save();
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update email settings",
      error: error.message,
    });
  }
};
