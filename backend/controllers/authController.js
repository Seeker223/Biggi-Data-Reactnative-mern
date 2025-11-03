// controllers/authController.js

const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const crypto = require('crypto'); // Required for hashing the incoming token


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

// @desc    Register a new user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = async (req, res, next) => {
    const { username, email, password, role } = req.body;
    try {
        // Create user (password is hashed by pre-save hook in model)
        const user = await User.create({ username, email, password, role });
        
        // After creation, send a JWT response
        sendTokenResponse(user, 201, res);
    } catch (error) {
        // Passes error to the centralized error handler
        next(error); 
    }
};

// @desc    Log user in
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = async (req, res, next) => {
    const { email, password } = req.body;

    // 1. Basic validation
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Please provide email and password' });
    }

    // 2. Find user and explicitly select password
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


// ---------------------- Email Verification ----------------------

// @desc    Send email verification link to user
// @route   POST /api/v1/auth/verify-email
// @access  Public
exports.sendVerificationEmail = async (req, res, next) => {
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


// @desc    Confirm account verification using token from email link
// @route   GET /api/v1/auth/confirm-verification/:token
// @access  Public
exports.confirmVerification = async (req, res, next) => {
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

// @desc    Forgot Password (Send email with reset link)
// @route   POST /api/v1/auth/forgotpassword
// @access  Public
exports.forgotPassword = async (req, res, next) => {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
        // Security: Send generic success message even if email doesn't exist
        return res.status(200).json({ success: true, data: 'Password reset email sent (if user exists).' });
    }

    // 1. Generate the reset token and save the hash to the user object
    const resetToken = user.getPasswordResetToken();
    await user.save({ validateBeforeSave: false }); 

    // 2. Create the reset URL (MUST point to your frontend's reset page, not the API route)
    // We use the API route here as a temporary test placeholder
    const resetURL = `${req.protocol}://${req.get('host')}/api/v1/auth/resetpassword/${resetToken}`;
    
    const message = `You are receiving this email because you requested a password reset. Click the link below to reset:\n\n${resetURL}\n\nIf you did not request this, please ignore this email.`;

    try {
        await sendEmail({
            email: user.email,
            subject: 'Password Reset Token',
            message: message,
        });

        res.status(200).json({ success: true, data: 'Email sent' });
    } catch (err) {
        // If email fails, clear the token from the user object
        user.passwordResetToken = undefined;
        user.passwordResetExpire = undefined;
        await user.save({ validateBeforeSave: false });
        
        console.error("Password reset email failed:", err);
        return res.status(500).json({ success: false, error: 'Email could not be sent' });
    }
};


// @desc    Reset Password (Set new password)
// @route   PUT /api/v1/auth/resetpassword/:token
// @access  Public
exports.resetPassword = async (req, res, next) => {
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