import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import chalk from "chalk"; // For colorized console logs

// --- Ensure logs directory exists ---
const logsDir = path.resolve("./logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
const logFile = path.join(logsDir, "email.log");

// --- Log helper ---
function logToFile(content) {
  const logEntry = `[${new Date().toISOString()}] ${content}\n`;
  fs.appendFileSync(logFile, logEntry);
}

const sendEmail = async (options) => {
  try {
    // 1️⃣ Configure transporter (Gmail SMTP)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT == 465, // true for SSL
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    // 2️⃣ Path to logo (ensure it exists)
    const logoPath = path.resolve("./assets/logo.png"); // e.g. backend/assets/logo.png
    const hasLogo = fs.existsSync(logoPath);

    // 3️⃣ HTML email template with inline logo
    const html = `
      <div style="font-family: Arial, sans-serif; background-color: #f5f6fa; padding: 40px;">
        <div style="max-width: 600px; background: white; border-radius: 12px; margin: auto; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <div style="text-align: center; margin-bottom: 20px;">
            ${
              hasLogo
                ? `<img src="cid:logoImage" alt="Biggi Data" width="100" style="border-radius: 8px;" />`
                : `<h2 style="color: #2b2d42;">Biggi Data</h2>`
            }
          </div>

          <p style="font-size: 16px; color: #2f3640;">Hi <strong>${options.username || "User"}</strong>,</p>
          <p style="font-size: 15px; color: #2f3640;">${options.message}</p>

          ${
            options.pin
              ? `
              <div style="text-align: center; margin: 20px 0;">
                <div style="font-size: 28px; letter-spacing: 8px; font-weight: bold; color: #1e90ff; background: #f0f8ff; padding: 10px 0; border-radius: 8px;">
                  ${options.pin}
                </div>
              </div>
              <p style="text-align: center; color: #6c757d;">This code will expire in 10 minutes.</p>
            `
              : ""
          }

          <p style="font-size: 14px; color: #6c757d;">If you didn’t request this, please ignore this email.</p>
          <hr style="margin-top: 30px;" />
          <p style="text-align: center; font-size: 13px; color: #aaa;">
            © ${new Date().getFullYear()} Biggi Data. All rights reserved.
          </p>
        </div>
      </div>
    `;

    // 4️⃣ Mail options with inline logo attachment
    const mailOptions = {
      from: `${process.env.FROM_NAME} <${process.env.SMTP_EMAIL}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html,
      attachments: hasLogo
        ? [
            {
              filename: "logo.png",
              path: logoPath,
              cid: "logoImage", // matches cid in HTML
            },
          ]
        : [],
    };

    // 5️⃣ Send email
    const info = await transporter.sendMail(mailOptions);

    // ✅ Success log
    const successMsg = `✅ Email sent to ${options.email} | Subject: ${options.subject} | Message ID: ${info.messageId}`;
    console.log(chalk.green(successMsg));
    logToFile(successMsg);
  } catch (error) {
    // ❌ Error log
    const errorMsg = `❌ Email error for ${options.email}: ${error.message}`;
    console.error(chalk.red(errorMsg));
    logToFile(errorMsg);
    throw new Error("Email could not be sent");
  }
};

export default sendEmail;
