import sendEmail from "./sendEmail.js";
import EmailSettings from "../models/EmailSettings.js";
import EmailEvent from "../models/EmailEvent.js";

const DEFAULT_RATE_LIMIT = 20;

const buildMessage = ({ title, bodyLines = [], footer = "Biggi Data" }) => {
  const safeLines = Array.isArray(bodyLines) ? bodyLines : [String(bodyLines || "")];
  const htmlLines = safeLines.map((line) => `<p>${line}</p>`).join("");
  return `
    <div style="font-family: Arial, sans-serif; color:#111; line-height:1.5;">
      <h2 style="margin:0 0 12px;">${title}</h2>
      ${htmlLines}
      <p style="margin-top:16px; font-size:12px; color:#666;">${footer}</p>
    </div>
  `;
};

const getSettings = async () => {
  let settings = await EmailSettings.findOne({});
  if (!settings) {
    settings = await EmailSettings.create({
      enabled: true,
      rateLimitPerHour: DEFAULT_RATE_LIMIT,
      perType: {},
    });
  }
  return settings;
};

const isAllowedBySettings = (settings, type = "generic") => {
  if (!settings?.enabled) return false;
  const perType = settings?.perType || {};
  if (Object.prototype.hasOwnProperty.call(perType, type)) {
    return Boolean(perType[type]);
  }
  return true;
};

const canSendByRateLimit = async ({ userId, email, limit }) => {
  const maxPerHour = Number(limit || DEFAULT_RATE_LIMIT);
  if (!Number.isFinite(maxPerHour) || maxPerHour <= 0) return true;
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const query = { createdAt: { $gte: since } };
  if (userId) query.userId = userId;
  else if (email) query.email = String(email || "").toLowerCase();
  else return true;

  const count = await EmailEvent.countDocuments(query);
  return count < maxPerHour;
};

export const sendUserEmail = async ({ email, subject, title, bodyLines, type = "generic", userId = null }) => {
  if (!email) {
    return { success: false, skipped: true, reason: "missing_email" };
  }
  try {
    const settings = await getSettings();
    if (!isAllowedBySettings(settings, type)) {
      return { success: false, skipped: true, reason: "type_disabled" };
    }
    const allowed = await canSendByRateLimit({
      userId,
      email,
      limit: settings?.rateLimitPerHour,
    });
    if (!allowed) {
      return { success: false, skipped: true, reason: "rate_limited" };
    }

    await sendEmail({
      email,
      subject: subject || title || "Biggi Data Notification",
      message: buildMessage({
        title: title || subject || "Biggi Data",
        bodyLines,
      }),
    });

    await EmailEvent.create({
      userId: userId || null,
      email: String(email || "").toLowerCase(),
      type: String(type || "generic"),
    });
    return { success: true };
  } catch (err) {
    console.error("Email send failed:", err?.message || err);
    return { success: false, skipped: false, reason: err?.message || "send_failed" };
  }
};
