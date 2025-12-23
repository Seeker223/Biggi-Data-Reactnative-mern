// backend/controllers/authController.js - UPDATED FOR RESEND
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";

// =====================================================
// EMAIL LOGGER FOR AUTH CONTROLLER
// =====================================================
const logAuthEmail = (email, action, status, details = "") => {
  const timestamp = new Date().toISOString();
  const emoji = status === "SENT" ? "✅" : status === "FAILED" ? "❌" : "🔄";
  console.log(`${emoji} [${action}] ${timestamp} - ${email}: ${details}`);
};

// =====================================================
// HELPER: FORMAT EMAIL HTML WITH PIN
// =====================================================
const formatPinEmail = (username, pin, isResend = false) => {
  const action = isResend ? "new verification code" : "verification code";
  const title = isResend ? "New Verification Code" : "Verify Your Account";
  
  return {
    subject: `${title} - Biggi Data`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Biggi Data</h1>
        </div>
        
        <div style="padding: 30px; background: #f9f9f9; border-radius: 0 0 10px 10px;">
          <h2 style="color: #2b2d42;">${isResend ? 'New Verification Code' : 'Welcome, ' + username + '!'}</h2>
          <p>Your ${action} is:</p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 25px 0;">
            ${pin}
          </div>
          
          <p style="color: #666;">This code will expire in 10 minutes.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px;">
            <p>© ${new Date().getFullYear()} Biggi Data. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </div>
    `,
    text: `Your Biggi Data verification code is: ${pin}. This code expires in 10 minutes.`
  };
};

// =====================================================
// REGISTER + AUTO OTP (UPDATED FOR RESEND)
// =====================================================
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username, email, and password are required" 
      });
    }

    // Check for duplicates
    const duplicateQuery = [{ email }, { username }];
    if (phoneNumber?.trim()) duplicateQuery.push({ phoneNumber });

    const existingUser = await User.findOne({ $or: duplicateQuery });
    if (existingUser) {
      let duplicateField = "User";
      if (existingUser.email === email) duplicateField = "Email";
      else if (phoneNumber && existingUser.phoneNumber === phoneNumber) duplicateField = "Phone number";
      else if (existingUser.username === username) duplicateField = "Username";

      return res.status(400).json({ 
        success: false, 
        error: `${duplicateField} already registered` 
      });
    }

    // Create user
    const user = await User.create({ 
      username, 
      email, 
      password, 
      phoneNumber: phoneNumber || undefined, 
      birthDate 
    });

    // Generate security pin
    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    // Format email content
    const emailContent = formatPinEmail(user.username, pin, false);

    // Send verification email via Resend API
    try {
      logAuthEmail(email, "REGISTRATION", "SENDING", "Sending verification email via Resend");
      
      await sendEmail({
        email: user.email,
        subject: emailContent.subject,
        message: emailContent.text,
        username: user.username,
        pin: pin
      });
      
      logAuthEmail(email, "REGISTRATION", "SENT", "Verification email sent successfully via Resend");
      
      res.status(201).json({
        success: true,
        message: "User registered successfully. Verification code sent to email.",
        requiresVerification: true, // Added to indicate verification is needed
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          phoneNumber: user.phoneNumber,
          age: user.age,
        }
      });
      
    } catch (emailError) {
      logAuthEmail(email, "REGISTRATION", "FAILED", `Resend email error: ${emailError.message}`);
      
      // User created but email failed - still return success
      res.status(201).json({
        success: true,
        message: "User registered successfully. However, we couldn't send the verification email. Please use the resend PIN feature.",
        warning: "Email service temporarily unavailable",
        requiresVerification: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          phoneNumber: user.phoneNumber,
          age: user.age,
        }
      });
    }

  } catch (error) {
    console.error("Register Error:", error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Duplicate key error - user may already exist"
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Server Error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// =====================================================
// LOGIN (ACCESS + REFRESH TOKEN) - ENHANCED
// =====================================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Please provide email and password"
      });
    }

    const user = await User.findOne({ email }).select("+password +refreshToken +securityPin +securityPinExpires");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Check if account is verified
    if (!user.isVerified) {
      // Check if PIN is still valid
      const hasValidPin = user.securityPinExpires && user.securityPinExpires > Date.now();

      if (hasValidPin) {
        return res.status(403).json({
          success: false,
          error: "Please verify your account first",
          code: "VERIFICATION_REQUIRED",
          canResend: true,
          requiresVerification: true
        });
      } else {
        // Generate new PIN if expired
        const newPin = user.generateSecurityPin();
        await user.save({ validateBeforeSave: false });

        // Try to resend PIN via Resend
        try {
          const emailContent = formatPinEmail(user.username, newPin, true);
          
          await sendEmail({
            email: user.email,
            subject: emailContent.subject,
            message: emailContent.text,
            username: user.username,
            pin: newPin
          });
          
          logAuthEmail(email, "LOGIN_RESEND", "SENT", "New verification code sent via Resend");
          
        } catch (emailError) {
          logAuthEmail(email, "LOGIN_RESEND", "FAILED", `Failed to send via Resend: ${emailError.message}`);
        }

        return res.status(403).json({
          success: false,
          error: "Account not verified. A new verification code has been sent to your email.",
          code: "VERIFICATION_REQUIRED",
          canResend: false,
          requiresVerification: true
        });
      }
    }

    // Verify password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Generate tokens
    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken();

    // Save refresh token
    await user.save({ validateBeforeSave: false });

    // Update last login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber,
        age: user.age,
        isVerified: user.isVerified,
        role: user.role,
        mainBalance: user.mainBalance,
        rewardBalance: user.rewardBalance,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({
      success: false,
      error: "Server Error"
    });
  }
};

// =====================================================
// REFRESH ACCESS TOKEN
// =====================================================
export const refreshTokenController = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: "No refresh token provided"
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select("+refreshToken");

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: "Invalid refresh token"
      });
    }

    const newAccessToken = user.getSignedJwtToken();
    res.status(200).json({
      success: true,
      accessToken: newAccessToken
    });
  } catch (err) {
    console.error("Refresh Token Error:", err);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: "Refresh token expired"
      });
    }

    res.status(401).json({
      success: false,
      error: "Invalid or expired refresh token"
    });
  }
};

// =====================================================
// GET AUTHENTICATED USER
// =====================================================
export const getMe = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Not authorized"
      });
    }

    const user = await User.findById(userId)
      .select("-password -refreshToken -securityPin -securityPinExpires");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (err) {
    console.error("GET /auth/me error:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

// =====================================================
// VERIFY SECURITY PIN
// =====================================================
export const verifySecurityPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({
        success: false,
        error: "Email and PIN are required"
      });
    }

    const user = await User.findOne({ email }).select("+securityPin +securityPinExpires");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Check if PIN exists and is not expired
    if (!user.securityPinExpires || user.securityPinExpires < Date.now()) {
      // Clean up expired PIN
      user.securityPin = undefined;
      user.securityPinExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        error: "PIN expired. Please request a new one.",
        code: "PIN_EXPIRED"
      });
    }

    // Verify PIN
    if (user.securityPin !== pin) {
      return res.status(400).json({
        success: false,
        error: "Invalid PIN"
      });
    }

    // Mark user as verified and clear PIN
    user.isVerified = true;
    user.securityPin = undefined;
    user.securityPinExpires = undefined;
    user.verifiedAt = new Date();
    await user.save({ validateBeforeSave: false });

    logAuthEmail(email, "VERIFICATION", "SUCCESS", "Account verified");

    // Generate tokens for automatic login after verification
    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Account verified successfully",
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber,
        age: user.age,
        isVerified: user.isVerified,
      }
    });
  } catch (error) {
    console.error("Verify PIN Error:", error);
    res.status(500).json({
      success: false,
      error: "Verification failed"
    });
  }
};

// =====================================================
// RESEND SECURITY PIN (UPDATED FOR RESEND)
// =====================================================
export const resendSecurityPin = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // If user is already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        error: "Account is already verified"
      });
    }

    // Generate new PIN
    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    // Format email content
    const emailContent = formatPinEmail(user.username, pin, true);

    // Send email via Resend API
    try {
      logAuthEmail(email, "RESEND_PIN", "SENDING", "Resending verification PIN via Resend");
      
      await sendEmail({
        email: user.email,
        subject: emailContent.subject,
        message: emailContent.text,
        username: user.username,
        pin: pin
      });
      
      logAuthEmail(email, "RESEND_PIN", "SENT", "New verification code sent via Resend");
      
      res.status(200).json({
        success: true,
        message: "New verification code sent successfully."
      });
      
    } catch (emailError) {
      logAuthEmail(email, "RESEND_PIN", "FAILED", `Resend email error: ${emailError.message}`);
      
      // Return partial success - PIN generated but email failed
      res.status(200).json({
        success: true,
        message: "New verification code generated but email delivery failed. Please try again later.",
        warning: "Email service temporarily unavailable"
      });
    }

  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resend verification code"
    });
  }
};

// =====================================================
// FORGOT PASSWORD (UPDATED FOR RESEND)
// =====================================================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      // Return generic message for security
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a password reset link will be sent."
      });
    }

    // Generate reset token
    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;

    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Biggi Data</h1>
        </div>
        
        <div style="padding: 30px; background: #f9f9f9; border-radius: 0 0 10px 10px;">
          <h2>Password Reset Request</h2>
          <p>You requested a password reset for your Biggi Data account.</p>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${resetUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Reset Password
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            This link will expire in 10 minutes.<br/>
            If you didn't request this reset, please ignore this email.
          </p>
        </div>
      </div>
    `;

    const textMessage = `Password reset link: ${resetUrl} (expires in 10 minutes)`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Password Reset Request - Biggi Data",
        message: textMessage
      });
      
      res.status(200).json({
        success: true,
        message: "Password reset email sent successfully."
      });
      
    } catch (emailError) {
      console.error("Forgot password email error:", emailError);
      
      // Clear reset token if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      
      res.status(500).json({
        success: false,
        error: "Failed to send password reset email. Please try again later."
      });
    }

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({
      success: false,
      error: "Server Error"
    });
  }
};

// =====================================================
// LOGOUT
// =====================================================
export const logout = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (userId) {
      await User.findByIdAndUpdate(userId, {
        refreshToken: null,
        lastLogout: new Date()
      });
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({
      success: false,
      error: "Server Error"
    });
  }
};