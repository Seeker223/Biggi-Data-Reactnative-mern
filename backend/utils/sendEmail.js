import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import chalk from "chalk";

// --- Ensure logs directory exists ---
const logsDir = path.resolve("./logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, "email.log");

// --- Log helper ---
function logToFile(content) {
  const logEntry = `[${new Date().toISOString()}] ${content}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log(chalk.blue(`📧 Email Log: ${content}`));
}

const sendEmail = async (options) => {
  // Validate environment variables
  if (!process.env.SMTP_HOST || !process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    const errorMsg = "❌ SMTP environment variables are not configured";
    console.error(chalk.red(errorMsg));
    logToFile(errorMsg);
    
    // Fallback: Log OTP to console in development
    if (process.env.NODE_ENV === "development" && options.pin) {
      console.log(chalk.yellow(`📝 [DEV] OTP for ${options.email}: ${options.pin}`));
      return { success: true, message: "OTP logged to console (development mode)" };
    }
    
    throw new Error("Email service configuration missing");
  }

  try {
    // 1️⃣ Configure transporter with multiple options
    const transporterConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_PORT == 465, // true for SSL
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
      },
      // Increase timeout for free tier services
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,
      socketTimeout: 30000,
      // Add TLS options for better compatibility
      tls: {
        rejectUnauthorized: false, // Accept self-signed certificates
        minVersion: "TLSv1.2"
      },
      // Pool configuration for better performance
      pool: true,
      maxConnections: 1,
      maxMessages: 10,
    };

    // For port 587 (TLS), use different configuration
    if (process.env.SMTP_PORT == 587) {
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    // Verify connection before sending
    await transporter.verify();
    console.log(chalk.green("✅ SMTP Connection verified"));

    // 2️⃣ Create HTML email template
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Biggi Data Verification</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f5f6fa; padding: 20px; }
          .container { max-width: 600px; background: white; border-radius: 12px; margin: auto; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 20px; }
          .logo { max-width: 150px; height: auto; }
          .otp-box { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            margin: 25px 0;
          }
          .footer { 
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            text-align: center;
            color: #666;
            font-size: 12px;
          }
          .button {
            display: inline-block;
            background: #000;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 5px;
            margin: 10px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="color: #2b2d42;">Biggi Data</h2>
          </div>
          
          <p>Hi <strong>${options.username || options.email}</strong>,</p>
          
          ${options.message}
          
          ${options.pin ? `
          <div class="otp-box">
            ${options.pin}
          </div>
          <p style="text-align: center; color: #6c757d;">
            This verification code will expire in 10 minutes.
          </p>
          ` : ""}
          
          <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} Biggi Data. All rights reserved.</p>
            <p>This is an automated message, please do not reply directly to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // 3️⃣ Mail options
    const mailOptions = {
      from: `"${process.env.FROM_NAME || 'Biggi Data'}" <${process.env.SMTP_EMAIL}>`,
      to: options.email,
      subject: options.subject,
      text: options.message.replace(/<[^>]*>/g, ''), // Plain text version
      html: html,
      // Add headers for better deliverability
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    };

    // 4️⃣ Send email
    const info = await transporter.sendMail(mailOptions);

    // ✅ Success log
    const successMsg = `✅ Email sent to ${options.email} | Subject: ${options.subject} | Message ID: ${info.messageId}`;
    console.log(chalk.green(successMsg));
    logToFile(`SUCCESS: ${successMsg}`);
    
    return { success: true, messageId: info.messageId };

  } catch (error) {
    // ❌ Error handling with detailed logging
    const errorMsg = `❌ Email error for ${options.email}: ${error.message}`;
    console.error(chalk.red(errorMsg));
    console.error(chalk.red('Full error:', error));
    
    // Log detailed error information
    logToFile(`ERROR: ${errorMsg}`);
    logToFile(`Stack: ${error.stack}`);
    
    // Check for specific SMTP errors
    if (error.code === 'ECONNREFUSED') {
      throw new Error('SMTP connection refused. Check your SMTP host and port.');
    } else if (error.code === 'EAUTH') {
      throw new Error('SMTP authentication failed. Check your email and password.');
    } else if (error.code === 'EENVELOPE') {
      throw new Error('Invalid email address.');
    }
    
    throw new Error(`Email could not be sent: ${error.message}`);
  }
};

export default sendEmail;