import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";

/* =====================================================
   REGISTER + AUTO OTP
===================================================== */
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate } = req.body;

    const duplicateQuery = [{ email }, { username }];
    if (phoneNumber && phoneNumber.trim() !== "") {
      duplicateQuery.push({ phoneNumber });
    }

    const existingUser = await User.findOne({ $or: duplicateQuery });
    if (existingUser) {
      let duplicateField = "User";
      if (existingUser.email === email) duplicateField = "Email";
      else if (phoneNumber && existingUser.phoneNumber === phoneNumber)
        duplicateField = "Phone number";
      else if (existingUser.username === username)
        duplicateField = "Username";

      return res
        .status(400)
        .json({ success: false, error: `${duplicateField} already registered` });
    }

    const user = await User.create({
      username,
      email,
      password,
      phoneNumber: phoneNumber || undefined,
      birthDate,
    });

    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    const message = `
      <h2>Welcome, ${user.username}!</h2>
      <p>Your 6-digit verification code is:</p>
      <h1 style="letter-spacing:4px;">${pin}</h1>
      <p>This code will expire in 10 minutes.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: "Verify Your Account - Biggi Data",
      message,
      html: message,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully. Verification code sent to email.",
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

/* =====================================================
   GET AUTHENTICATED USER
===================================================== */
export const getMe = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authorized" });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("GET /auth/me error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/* =====================================================
   VERIFY SECURITY PIN (OTP)
===================================================== */
export const verifySecurityPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    const user = await User.findOne({ email }).select(
      "+securityPin +securityPinExpires"
    );
    if (!user)
      return res.status(404).json({ success: false, error: "User not found" });

    if (!user.securityPinExpires || user.securityPinExpires < Date.now()) {
      return res.status(400).json({ success: false, error: "PIN expired" });
    }

    if (user.securityPin !== pin) {
      return res.status(400).json({ success: false, error: "Invalid PIN" });
    }

    user.isVerified = true;
    user.securityPin = undefined;
    user.securityPinExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Account verified successfully",
    });
  } catch (error) {
    console.error("Verify PIN Error:", error);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
};

/* =====================================================
   LOGIN (ACCESS + REFRESH TOKEN)
===================================================== */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Please provide email and password" });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user)
      return res.status(400).json({ success: false, error: "Invalid credentials" });

    if (!user.isVerified) {
      return res
        .status(403)
        .json({ success: false, error: "Please verify your account first" });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch)
      return res.status(400).json({ success: false, error: "Invalid credentials" });

    // 🔐 Access token (short-lived)
    const accessToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // 🔁 Refresh token (long-lived)
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "30d" }
    );

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
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

/* =====================================================
   REFRESH ACCESS TOKEN (REQUIRED)
===================================================== */
export const refreshTokenController = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, error: "No refresh token provided" });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    const newAccessToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired refresh token",
    });
  }
};

/* =====================================================
   RESEND OTP
===================================================== */
export const resendSecurityPin = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ success: false, error: "User not found" });

    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    const message = `
      <p>Your new verification code is:</p>
      <h1 style="letter-spacing:4px;">${pin}</h1>
      <p>This code will expire in 10 minutes.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: "New Verification Code - Biggi Data",
      message,
      html: message,
    });

    res.status(200).json({
      success: true,
      message: "New verification code sent successfully.",
    });
  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resend verification code",
    });
  }
};
