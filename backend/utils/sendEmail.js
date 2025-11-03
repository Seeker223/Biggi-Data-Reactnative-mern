// utils/sendEmail.js

const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    // 1. Create a transporter object using SMTP
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_PORT == 465, // true for 465 (SSL), false for other ports (like 587 TLS)
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    // 2. Define the email message options
    const message = {
        from: `${process.env.FROM_NAME} <${process.env.SMTP_EMAIL}>`,
        to: options.email,        // Recipient's email
        subject: options.subject, // Email subject
        text: options.message,    // Plain text body
        html: options.html,       // Optional: HTML body
    };

    // 3. Send the email
    const info = await transporter.sendMail(message);

    console.log('Message sent: %s', info.messageId);
};

module.exports = sendEmail;