// controllers/authController.js

import User from '../models/User.js'; // MUST include .js extension
import sendEmail from '../utils/sendEmail.js'; // MUST include .js extension
import crypto from 'crypto'; // Node built-in modules do not need .js extension

// ---------------------- Helper Function ----------------------

// Helper function to send JWT token response (used by both register, login, and resetPassword)
const sendTokenResponse = (user, statusCode, res) => {
    // 1. Get token from model method
    const token = user.getSignedJwtToken();

    // 2. Define cookie options
    
    // Ensure JWT_EXPIRE is converted to a number (* 1) before calculation.
    const cookieExpirationDays = process.env.JWT_EXPIRE * 1 || 30; 
    
    const options = {
        expires: new Date(
            Date.now() + cookieExpirationDays * 24 * 60 * 60 * 1000
        ),
        httpOnly: true, // Prevents client-side JS access (XSS defense)
        secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
    };

    // 3. Send the response: Set cookie and return token in JSON body
    res.status(statusCode)
       .cookie('token', token, options) 
       .json({ success: true, token });
};


// ---------------------- Public Authentication Routes ----------------------

// @desc    Register a new user
// @route   POST /api/v1/auth/register
// @access  Public
export const register = async (req, res, next) => {
    const { username, email, password, phoneNumber, birthDate, role } = req.body;

    try {
        // Create user
        const user = await User.create({ username, email, password, phoneNumber, birthDate, role });

        // ✅ Send welcome email via SMTP
        try {
            await sendEmail({
                email: user.email,
                subject: "Welcome to Biggi Data 🎉",
                html: `
                    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#333">
                        <h2>Welcome, ${user.username || "User"}!</h2>
                        <p>Thank you for joining <strong>Biggi Data</strong>.</p>
                        <p>Start exploring and enjoy exclusive data rewards and promotions.</p>
                        <p>Best regards,<br/><strong>Biggi Data Team</strong></p>
                    </div>
                `,
            });
            console.log(`✅ Registration email sent to ${user.email}`);
        } catch (emailError) {
            console.error("❌ Failed to send registration email:", emailError);
        }

        // Continue login flow
        sendTokenResponse(user, 201, res);

    } catch (error) {
        next(error);
    }
};

// @desc    Log user in
// @route   POST /api/v1/auth/login
// @access  Public
export const login = async (req, res, next) => {
    const { email, password } = req.body;

    // 1. Basic validation
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Please provide email and password' });
    }

    // 2. Find user and explicitly select password
    // NOTE: If you are using Mongoose, matchPassword function must be defined on the User schema
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // 3. Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // 4. Send JWT token response
    sendTokenResponse(user, 200, res);
};

// --- SEND SECURITY PIN ---
export const sendSecurityPin = async (req, res, next) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // generate a 6-digit code
        const pin = Math.floor(100000 + Math.random() * 900000).toString();

        user.securityPin = pin;
        user.securityPinExpires = Date.now() + 10 * 60 * 1000; // valid for 10 min
        await user.save();

        await sendEmail({
            email: user.email,
            subject: "Your Biggi Data Security PIN",
            html: `
                <div style="font-family:Arial,sans-serif">
                    <h2>Security PIN</h2>
                    <p>Hello ${user.username || "User"},</p>
                    <p>Your 6-digit security PIN is:</p>
                    <h1 style="letter-spacing:6px">${pin}</h1>
                    <p>This code expires in 10 minutes.</p>
                    <p>— Biggi Data Team</p>
                </div>`,
        });

        res.status(200).json({ success: true, message: "PIN sent to email" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Failed to send PIN" });
    }
};

// --- VERIFY SECURITY PIN ---
export const verifySecurityPin = async (req, res, next) => {
    const { email, pin } = req.body;
    try {
        const user = await User.findOne({ email });
        if (
            !user ||
            user.securityPin !== pin ||
            !user.securityPinExpires ||
            user.securityPinExpires < Date.now()
        ) {
            return res.status(400).json({ success: false, message: "Invalid or expired PIN" });
        }

        // clear fields once used
        user.securityPin = undefined;
        user.securityPinExpires = undefined;
        await user.save();

        res.status(200).json({ success: true, message: "PIN verified successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "PIN verification failed" });
    }
};


// @desc    Send email verification link to user
// @route   POST /api/v1/auth/verify-email
// @access  Public
export const sendVerificationEmail = async (req, res, next) => {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    // 1. Generate the unhashed token and save the hashed version to the DB
    const verificationToken = user.getVerificationToken();
    await user.save({ validateBeforeSave: false }); 

    // 2. Create the verification URL 
    const verifyURL = `${req.protocol}://${req.get('host')}/api/v1/auth/confirm-verification/${verificationToken}`;
    
    const message = `You are receiving this email because you need to verify your account. Please click the link below to continue:\n\n${verifyURL}`;

    try {
        await sendEmail({
            email: user.email,
            subject: 'Account Verification Token',
            message: message,
        });

        res.status(200).json({ success: true, data: 'Verification email sent' });
    } catch (err) {
        // If email fails, clear the token from the user object and return error
        user.verificationToken = undefined;
        user.verificationTokenExpire = undefined;
        await user.save({ validateBeforeSave: false });
        
        console.error("Email failed:", err);
        return res.status(500).json({ success: false, error: 'Email could not be sent' });
    }
};


// @desc    Confirm account verification using token from email link
// @route   GET /api/v1/auth/confirm-verification/:token
// @access  Public
export const confirmVerification = async (req, res, next) => {
    // 1. Get the hashed token from the request parameters
    const incomingToken = req.params.token;

    // 2. Hash the incoming token to compare with the hash stored in the DB
    const hashedToken = crypto
        .createHash('sha256')
        .update(incomingToken)
        .digest('hex');

    // 3. Find user by the stored hash AND ensure the token hasn't expired
    const user = await User.findOne({
        verificationToken: hashedToken,
        verificationTokenExpire: { $gt: Date.now() } 
    });

    if (!user) {
        return res.status(400).json({ success: false, error: 'Invalid or expired verification token.' });
    }

    // 4. Update the user status and clear token fields
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    
    await user.save();
    
    // Log the user in immediately after verification
    sendTokenResponse(user, 200, res);
};


// ---------------------- Password Reset ----------------------

// @desc    Forgot Password (Send email with reset link)
// @route   POST /api/v1/auth/forgotpassword
// @access  Public
export const forgotPassword = async (req, res, next) => {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
        // Security: Send generic success message even if email doesn't exist
        return res.status(200).json({ success: true, data: 'Password reset email sent (if user exists).' });
    }

    // 1. Generate the reset token and save the hash to the user object
    const resetToken = user.getPasswordResetToken();
    await user.save({ validateBeforeSave: false }); 

    // 2. Create the reset URL (MUST point to your frontend's reset page)
    const resetURL = `${process.env.FRONTEND_URL}/resetpassword/${resetToken}`;

    const message = `
        <div style="font-family: Arial, sans-serif; color:#333">
            <h2>Password Reset Request</h2>
            <p>Hello ${user.username || "User"},</p>
            <p>You requested to reset your password. Click the button below:</p>
            <a href="${resetURL}" 
                style="display:inline-block; padding:10px 20px; background-color:#000; color:#fff; 
                text-decoration:none; border-radius:6px;">Reset Password</a>
            <p>If you didn't request this, please ignore this email.</p>
            <p>— Biggi Data Support</p>
        </div>
    `;

    try {
        await sendEmail({
            email: user.email,
            subject: "Reset Your Biggi Data Password",
            html: message,
        });
        res.status(200).json({ success: true, data: 'Password reset email sent (if user exists).' });
    } catch (err) {
        // If email fails, clear the token and return error
        user.passwordResetToken = undefined;
        user.passwordResetExpire = undefined;
        await user.save({ validateBeforeSave: false });
        
        console.error("Email failed:", err);
        return res.status(500).json({ success: false, error: 'Email could not be sent' });
    }
};


// @desc    Reset Password (Set new password)
// @route   PUT /api/v1/auth/resetpassword/:token
// @access  Public
export const resetPassword = async (req, res, next) => {
    // 1. Get the hashed token from the request parameter
    const incomingToken = req.params.token;
    
    // 2. Hash the incoming token to compare with the hash stored in the DB
    const hashedToken = crypto
        .createHash('sha256')
        .update(incomingToken)
        .digest('hex');

    // 3. Find user by the stored hash AND ensure the token hasn't expired
    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpire: { $gt: Date.now() } 
    });

    if (!user) {
        return res.status(400).json({ success: false, error: 'Invalid or expired reset token.' });
    }

    // 4. Set new password and clear token fields
    if (!req.body.password) {
        return res.status(400).json({ success: false, error: 'Please provide a new password.' });
    }
    
    user.password = req.body.password; // The pre-save hook will hash this new password
    user.passwordResetToken = undefined;
    user.passwordResetExpire = undefined;
    
    await user.save(); // Saves the new password (hashed)

    // 5. Log user in immediately after successful reset
    sendTokenResponse(user, 200, res);
};