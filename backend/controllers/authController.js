// backend/controllers/authController.js - COMPLETE SIMPLIFIED MVP VERSION
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const generateReferralCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase() +
  Math.random().toString(36).slice(2, 6).toUpperCase();

const buildUniqueReferralCode = async () => {
  for (let i = 0; i < 8; i += 1) {
    const code = generateReferralCode();
    const exists = await User.findOne({ referralCode: code }).select("_id");
    if (!exists) return code;
  }
  // Fallback in the rare case of repeated collision
  return `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
};

const ensureReferralCode = async (user) => {
  if (!user || user.referralCode) return user;
  user.referralCode = await buildUniqueReferralCode();
  return user;
};

// =====================================================
// REGISTER (NO OTP, NO EMAIL VERIFICATION)
// =====================================================
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate, state, referralCode } = req.body;
    const normalizedUsername = username?.trim();
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phoneNumber?.trim();
    const normalizedState = state?.trim();

    // Validate required fields
    if (!normalizedUsername || !normalizedEmail || !password || !normalizedState) {
      return res.status(400).json({ 
        success: false, 
        error: "Username, email, password, and state are required" 
      });
    }

    // Check for duplicates
    const duplicateQuery = [{ email: normalizedEmail }, { username: normalizedUsername }];
    if (normalizedPhone) duplicateQuery.push({ phoneNumber: normalizedPhone });

    const existingUser = await User.findOne({ $or: duplicateQuery });
    if (existingUser) {
      let duplicateField = "User";
      if (existingUser.email === normalizedEmail) duplicateField = "Email";
      else if (normalizedPhone && existingUser.phoneNumber === normalizedPhone) duplicateField = "Phone number";
      else if (existingUser.username === normalizedUsername) duplicateField = "Username";

      return res.status(400).json({ 
        success: false, 
        error: `${duplicateField} already registered` 
      });
    }

    // Create user - automatically mark as verified
    const uniqueReferralCode = await buildUniqueReferralCode();
    const normalizedReferralCode = referralCode?.trim().toUpperCase() || null;
    if (normalizedReferralCode) {
      const referrer = await User.findOne({ referralCode: normalizedReferralCode }).select("_id");
      if (!referrer) {
        return res.status(400).json({
          success: false,
          error: "Invalid referral code",
        });
      }
    }

    const user = await User.create({ 
      username: normalizedUsername, 
      email: normalizedEmail, 
      password, 
      phoneNumber: normalizedPhone || undefined, 
      birthDate,
      state: normalizedState,
      referralCode: uniqueReferralCode,
      referredByCode: normalizedReferralCode,
      isVerified: true,  // Auto-verify for MVP
      verifiedAt: new Date()  // Set verification timestamp
    });

    user.addNotification({
      type: "Welcome",
      status: "success",
      message: `Welcome to Biggi Data, ${user.username}!`,
    });

    // Generate tokens immediately
    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken();
    
    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    res.status(201).json({
      success: true,
      message: "Registration successful!",
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber,
        age: user.age,
        isVerified: true,
        notifications: user.notifications || 0,
        state: user.state,
        referralCode: user.referralCode,
        referredByCode: user.referredByCode,
        userRole: user.userRole || null,
      }
    });

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
// LOGIN (SIMPLIFIED - NO VERIFICATION CHECKS)
// =====================================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const identifier = String(email || "").trim();
    const normalizedEmail = identifier.toLowerCase();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: "Please provide email and password"
      });
    }

    const user = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { username: { $regex: `^${escapeRegex(identifier)}$`, $options: "i" } },
      ],
    }).select("+password +refreshToken");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid credentials"
      });
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

    // Save refresh token and update last login
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await ensureReferralCode(user);
    user.addNotification({
      type: "Welcome",
      status: "success",
      message: `Welcome back, ${user.username}!`,
    });
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
        isVerified: true,
        role: user.role,
        userRole: user.userRole || null,
        state: user.state,
        referralCode: user.referralCode,
        referredByCode: user.referredByCode,
        mainBalance: user.mainBalance,
        rewardBalance: user.rewardBalance,
        notifications: user.notifications || 0,
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
      .select("-password -refreshToken");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (!user.referralCode) {
      await ensureReferralCode(user);
      await user.save({ validateBeforeSave: false });
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
// FORGOT PASSWORD (OPTIONAL - KEEP IF YOU WANT PASSWORD RESET)
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

    // Generate reset token (if you implement password reset later)
    // const resetToken = user.getResetPasswordToken();
    // await user.save({ validateBeforeSave: false });
    
    // For now, just return success without sending email
    res.status(200).json({
      success: true,
      message: "Password reset functionality will be available soon."
    });

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
      const user = await User.findById(userId);
      if (user) {
        user.refreshToken = null;
        user.lastLogout = new Date();
        user.addNotification({
          type: "Signout",
          status: "info",
          message: `Last sign out: ${new Date().toLocaleString()}`,
        });
        await user.save({ validateBeforeSave: false });
      }
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
