import sendEmail from "./sendEmail.js";

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

export const sendUserEmail = async ({ email, subject, title, bodyLines }) => {
  if (!email) return;
  try {
    await sendEmail({
      email,
      subject: subject || title || "Biggi Data Notification",
      message: buildMessage({
        title: title || subject || "Biggi Data",
        bodyLines,
      }),
    });
  } catch (err) {
    console.error("Email send failed:", err?.message || err);
  }
};
