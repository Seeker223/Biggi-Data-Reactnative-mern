// backend/utils/sendEmail.js - UPDATED FOR RESEND API
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

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

// Initialize Resend client
let resend;
try {
  if (!process.env.RESEND_API_KEY) {
    console.warn(chalk.yellow("⚠️ RESEND_API_KEY not found in environment variables"));
  } else {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch (error) {
  console.error(chalk.red("❌ Failed to initialize Resend client:"), error);
}

const sendEmail = async (options) => {
  // Validate Resend API key
  if (!process.env.RESEND_API_KEY || !resend) {
    const errorMsg = "❌ Resend API key not configured";
    console.error(chalk.red(errorMsg));
    logToFile(errorMsg);
    
    // Fallback: Log OTP to console in development
    if (process.env.NODE_ENV === "development" && options.pin) {
      console.log(chalk.yellow(`📝 [DEV] OTP for ${options.email}: ${options.pin}`));
      return { success: true, message: "OTP logged to console (development mode)" };
    }
    
    throw new Error("Email service configuration missing - Resend API key required");
  }

  try {
    // Create HTML email template
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

    // Get from email from environment or use default verified domain
    const fromEmail = process.env.RESEND_FROM_EMAIL || 
                     process.env.SMTP_EMAIL || 
                     `no-reply@${process.env.RESEND_DOMAIN || 'resend.dev'}`;
    
    const fromName = process.env.FROM_NAME || 'Biggi Data';

    // Send email using Resend
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [options.email],
      subject: options.subject,
      html: html,
      text: options.message.replace(/<[^>]*>/g, ''), // Plain text version
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'X-Entity-Ref': `biggi-data-${Date.now()}`
      },
      tags: [
        {
          name: 'category',
          value: options.pin ? 'verification' : 'notification'
        }
      ]
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    // ✅ Success log
    const successMsg = `✅ Email sent to ${options.email} via Resend | Subject: ${options.subject} | Message ID: ${data.id}`;
    console.log(chalk.green(successMsg));
    logToFile(`RESEND_SUCCESS: ${successMsg}`);
    
    return { 
      success: true, 
      messageId: data.id,
      provider: 'resend'
    };

  } catch (error) {
    // ❌ Error handling with detailed logging
    const errorMsg = `❌ Resend email error for ${options.email}: ${error.message}`;
    console.error(chalk.red(errorMsg));
    console.error(chalk.red('Full error:', error));
    
    // Log detailed error information
    logToFile(`RESEND_ERROR: ${errorMsg}`);
    logToFile(`Stack: ${error.stack}`);
    
    // Check for specific Resend errors
    if (error.message.includes('API key')) {
      throw new Error('Resend API key is invalid or missing');
    } else if (error.message.includes('domain')) {
      throw new Error('Resend domain not verified. Please verify your domain in Resend dashboard.');
    } else if (error.message.includes('rate limit')) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    
    throw new Error(`Email could not be sent: ${error.message}`);
  }
};

export default sendEmail;