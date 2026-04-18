// backend/controllers/authController.js - COMPLETE SIMPLIFIED MVP VERSION
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";
import { notifyAdmins } from "../utils/notifyAdmins.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

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

const parseBirthDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // Accept DD-MM-YY, DD-MM-YYYY, or YYYY-MM-DD
  let day;
  let month;
  let year;

  const short = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (short) {
    day = Number(short[1]);
    month = Number(short[2]);
    const year2 = Number(short[3]);
    year = year2 >= 50 ? 1900 + year2 : 2000 + year2;
  }

  const long = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!day && long) {
    day = Number(long[1]);
    month = Number(long[2]);
    year = Number(long[3]);
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day && iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  }

  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return date;
};

const generateEmailOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const hashOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp)).digest("hex");

const sendVerificationEmail = async ({ email, username, otp }) => {
  const message = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <h2 style="margin:0 0 12px;">Verify your Biggi Data account</h2>
      <p>Hello ${username || "there"},</p>
      <p>Your verification code is:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0;">${otp}</div>
      <p>This code expires in 10 minutes.</p>
    </div>
  `;
  await sendEmail({
    email,
    subject: "Your Biggi Data verification code",
    message,
  });
};

const OTP_TTL_MS = 10 * 60 * 1000;
const isVerificationDisabled = () =>
  ["1", "true", "yes"].includes(String(process.env.DISABLE_EMAIL_VERIFICATION || "").toLowerCase());

const getRequiredAppFromOrigin = (origin = "", clientHeader = "") => {
  const lower = String(origin || "").toLowerCase();
  const lowerHeader = String(clientHeader || "").toLowerCase();
  if (!lower && !lowerHeader) return null;
  if (lowerHeader.includes("biggi-house") || lower.includes("biggi-house.vercel.app")) return "biggi_house";
  if (
    lowerHeader.includes("biggi-data") ||
    lower.includes("biggidata.com.ng") ||
    lower.includes("biggi-data-frontend.vercel.app")
  )
    return "biggi_data";
  return null;
};

// =====================================================
// REGISTER (NO OTP, NO EMAIL VERIFICATION)
// =====================================================
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate, state, referralCode, bvn, nin } = req.body;
    const normalizedUsername = username?.trim();
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phoneNumber?.trim();
    const normalizedState = state?.trim();
    const parsedBirthDate = parseBirthDate(birthDate);

    // Validate required fields
    if (!normalizedUsername || !normalizedEmail || !password || !normalizedState || !parsedBirthDate || !normalizedPhone) {
      return res.status(400).json({ 
        success: false, 
        error: "Username, email, password, phone number, state, valid birth date, and NIN are required" 
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

    const normalizedBvn = String(bvn || "").replace(/\D/g, "").trim() || null;
    const normalizedNin = String(nin || "").replace(/\D/g, "").trim() || null;
    if (!normalizedNin) {
      return res.status(400).json({ success: false, error: "NIN is required" });
    }
    if (normalizedBvn && !/^\d{11}$/.test(normalizedBvn)) {
      return res.status(400).json({ success: false, error: "BVN must be 11 digits" });
    }
    if (normalizedNin && !/^\d{11}$/.test(normalizedNin)) {
      return res.status(400).json({ success: false, error: "NIN must be 11 digits" });
    }

    const user = await User.create({ 
      username: normalizedUsername, 
      email: normalizedEmail, 
      password, 
      phoneNumber: normalizedPhone || undefined, 
      birthDate: parsedBirthDate,
      state: normalizedState,
      bvn: normalizedBvn || undefined,
      nin: normalizedNin || undefined,
      referralCode: uniqueReferralCode,
      referredByCode: normalizedReferralCode,
      userRole: String(req.body?.userRole || "").toLowerCase() === "merchant" ? "merchant" : "private",
      allowedApps: (() => {
        const origin = String(req.headers.origin || "");
        const header = String(req.headers["x-client-app"] || "");
        const fromBiggiHouse =
          header.toLowerCase().includes("biggi-house") || origin.toLowerCase().includes("biggi-house.vercel.app");
        const requestedRole = String(req.body?.userRole || "").toLowerCase();
        const apps = fromBiggiHouse ? ["biggi_house"] : ["biggi_data"];
        if (requestedRole === "merchant") {
          if (!apps.includes("biggi_data")) apps.push("biggi_data");
          if (!apps.includes("biggi_house")) apps.push("biggi_house");
        }
        return apps;
      })(),
      isVerified: isVerificationDisabled(),
      verifiedAt: isVerificationDisabled() ? new Date() : null
    });

    if (!isVerificationDisabled()) {
      const otp = generateEmailOtp();
      user.emailOtpHash = hashOtp(otp);
      user.emailOtpExpires = new Date(Date.now() + OTP_TTL_MS);
      await user.save({ validateBeforeSave: false });

      try {
        await sendVerificationEmail({
          email: user.email,
          username: user.username,
          otp,
        });
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
      }
    }

    user.addNotification({
      type: "Welcome",
      status: "success",
      message: `Welcome to Biggi Data, ${user.username}!`,
    });

    await sendUserEmail({
      userId: user._id,
      type: "signup",
      email: user.email,
      subject: "Welcome to Biggi Data",
      title: "Welcome to Biggi Data",
      bodyLines: [
        `Hi ${user.username || "there"}, your account has been created successfully.`,
        "You can now enjoy data purchases, games, and rewards inside Biggi Data.",
      ],
    });

    await notifyAdmins({
      type: "User Signup",
      status: "info",
      message: `New signup: ${user.username} (${user.email}) joined Biggi Data.`,
    });

    if (isVerificationDisabled()) {
      const accessToken = user.getSignedJwtToken();
      const refreshToken = user.getRefreshToken();
      user.refreshToken = refreshToken;
      await user.save({ validateBeforeSave: false });

      return res.status(201).json({
        success: true,
        message: "Registration successful!",
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          photo: user.photo || null,
          phoneNumber: user.phoneNumber,
          age: user.age,
          isVerified: user.isVerified,
          notifications: user.notifications || 0,
          state: user.state,
          referralCode: user.referralCode,
          referredByCode: user.referredByCode,
          bvn: user.bvn || null,
          nin: user.nin || null,
          userRole: user.userRole || null,
          biometricEnabled: Boolean(user.biometricAuth?.enabled),
          transactionPinEnabled: Boolean(user.transactionPinHash),
        }
      });
    }

    res.status(201).json({
      success: true,
      message: "Registration successful! Please verify your email.",
      requiresVerification: true,
      email: user.email,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
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
    const { email, password, rememberMe } = req.body;
    const identifier = String(email || "").trim();
    const normalizedEmail = identifier.toLowerCase();
    const shouldRemember = Boolean(rememberMe);

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

    if (!isVerificationDisabled() && !user.isVerified) {
      return res.status(403).json({
        success: false,
        error: "Please verify your email to continue",
        requiresVerification: true,
        email: user.email,
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

    const requiredApp = getRequiredAppFromOrigin(
      req.headers.origin,
      req.headers["x-client-app"]
    );
    let allowedApps =
      Array.isArray(user.allowedApps) && user.allowedApps.length ? user.allowedApps : ["biggi_data"];
    
    // Auto-authorize cross-app access: if user logs in from a new app, add it to allowedApps
    if (requiredApp && !allowedApps.includes(requiredApp)) {
      allowedApps = [...allowedApps, requiredApp];
      user.allowedApps = allowedApps;
      await user.save();
    }

    // Generate tokens
    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken({ rememberMe: shouldRemember });

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

    await notifyAdmins({
      type: "User Login",
      status: "info",
      message: `User login: ${user.username} (${user.email}) logged in.`,
    });

    res.status(200).json({
      success: true,
      token: accessToken,
      refreshToken,
      rememberMe: shouldRemember,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        photo: user.photo || null,
        phoneNumber: user.phoneNumber,
        age: user.age,
        isVerified: true,
        role: user.role,
        userRole: user.userRole || null,
        allowedApps: allowedApps,
        state: user.state,
        referralCode: user.referralCode,
        referredByCode: user.referredByCode,
        bvn: user.bvn || null,
        nin: user.nin || null,
        mainBalance: user.mainBalance,
        rewardBalance: user.rewardBalance,
        notifications: user.notifications || 0,
        biometricEnabled: Boolean(user.biometricAuth?.enabled),
        transactionPinEnabled: Boolean(user.transactionPinHash),
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
// VERIFY EMAIL OTP
// =====================================================
export const verifyEmailOtp = async (req, res) => {
  try {
    if (isVerificationDisabled()) {
      return res.status(403).json({
        success: false,
        error: "Email verification is disabled",
      });
    }
    const { email, otp } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const code = String(otp || "").trim();

    if (!normalizedEmail || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        error: "Email and 6-digit OTP are required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+emailOtpHash +emailOtpExpires +refreshToken"
    );
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    if (user.isVerified) {
      return res.status(200).json({ success: true, message: "Email already verified" });
    }

    if (!user.emailOtpHash || !user.emailOtpExpires || user.emailOtpExpires.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        error: "OTP expired. Please request a new code.",
      });
    }

    const isMatch = user.emailOtpHash === hashOtp(code);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Invalid OTP code" });
    }

    user.isVerified = true;
    user.verifiedAt = new Date();
    user.emailOtpHash = null;
    user.emailOtpExpires = null;

    const accessToken = user.getSignedJwtToken();
    const refreshToken = user.getRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        photo: user.photo || null,
        phoneNumber: user.phoneNumber,
        age: user.age,
        isVerified: user.isVerified,
        notifications: user.notifications || 0,
        state: user.state,
        referralCode: user.referralCode,
        referredByCode: user.referredByCode,
        userRole: user.userRole || null,
        biometricEnabled: Boolean(user.biometricAuth?.enabled),
        transactionPinEnabled: Boolean(user.transactionPinHash),
      },
    });
  } catch (error) {
    console.error("Verify email OTP error:", error);
    return res.status(500).json({ success: false, error: "Server Error" });
  }
};

// =====================================================
// RESEND EMAIL OTP
// =====================================================
export const resendEmailOtp = async (req, res) => {
  try {
    if (isVerificationDisabled()) {
      return res.status(403).json({
        success: false,
        error: "Email verification is disabled",
      });
    }
    const { email } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, error: "Email is required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (user.isVerified) {
      return res.status(200).json({ success: true, message: "Email already verified" });
    }

    const otp = generateEmailOtp();
    user.emailOtpHash = hashOtp(otp);
    user.emailOtpExpires = new Date(Date.now() + OTP_TTL_MS);
    await user.save({ validateBeforeSave: false });

    await sendVerificationEmail({
      email: user.email,
      username: user.username,
      otp,
    });

    return res.status(200).json({
      success: true,
      message: "Verification code sent",
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    });
  } catch (error) {
    console.error("Resend email OTP error:", error);
    return res.status(500).json({ success: false, error: "Server Error" });
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
    const user = await User.findById(decoded.id).select("+refreshToken +refreshTokenExpiresAt +refreshTokenRememberMe");

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: "Invalid refresh token"
      });
    }

    if (user.refreshTokenExpiresAt && new Date(user.refreshTokenExpiresAt).getTime() <= Date.now()) {
      user.refreshToken = null;
      user.refreshTokenExpiresAt = null;
      user.refreshTokenRememberMe = false;
      await user.save({ validateBeforeSave: false });
      return res.status(401).json({
        success: false,
        error: "Refresh token expired",
      });
    }

    const newAccessToken = user.getSignedJwtToken();
    const newRefreshToken = user.getRefreshToken({
      rememberMe: Boolean(user.refreshTokenRememberMe),
    });
    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });
    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      rememberMe: Boolean(user.refreshTokenRememberMe),
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
      .select("-password +refreshToken +transactionPinHash +refreshTokenRememberMe +refreshTokenExpiresAt");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (!user.referralCode) {
      await ensureReferralCode(user);
    }
    const newRefreshToken = user.getRefreshToken({
      rememberMe: Boolean(user.refreshTokenRememberMe),
    });
    await user.save({ validateBeforeSave: false });

    const safeUser = user.toObject();
    const credsCount = Array.isArray(safeUser?.biometricAuth?.credentials)
      ? safeUser.biometricAuth.credentials.length
      : 0;
    safeUser.biometricEnabled = Boolean(safeUser?.biometricAuth?.enabled);
    safeUser.transactionPinEnabled = Boolean(safeUser?.transactionPinHash);
    safeUser.biometricCredentialsCount = credsCount;
    delete safeUser.biometricAuth;
    delete safeUser.transactionPinHash;

    res.status(200).json({
      success: true,
      user: safeUser,
      refreshToken: newRefreshToken,
      rememberMe: Boolean(user.refreshTokenRememberMe),
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
        user.refreshTokenExpiresAt = null;
        user.refreshTokenRememberMe = false;
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



