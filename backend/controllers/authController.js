import crypto from "crypto";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";

// ---------------------- REGISTER + AUTO OTP ----------------------
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate } = req.body;

    // Check for duplicate user (by email, phone, or username)
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }, { username }],
    });

    if (existingUser) {
      const duplicateField = existingUser.email === email
        ? "Email"
        : existingUser.phoneNumber === phoneNumber
        ? "Phone number"
        : "Username";
      return res
        .status(400)
        .json({ success: false, error: `${duplicateField} already registered` });
    }

    // Create user
    const user = await User.create({ username, email, password, phoneNumber, birthDate });

    // Generate and save 6-digit OTP
    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    // Send OTP email
    const message = `
      <h2>Welcome, ${user.username}!</h2>
      <p>Your 6-digit verification code is:</p>
      <h1 style="letter-spacing:4px;">${pin}</h1>
      <p>This code will expire in 10 minutes.</p>
    `;

    await sendEmail({
      email: user.email,
      subject: "Verify Your Account - Biggi Data",
      message: message,
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

// ---------------------- VERIFY PIN ----------------------
export const verifySecurityPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    const user = await User.findOne({ email }).select("+securityPin +securityPinExpires");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

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

    res.status(200).json({ success: true, message: "Account verified successfully" });
  } catch (error) {
    console.error("Verify PIN Error:", error);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
};

// ---------------------- LOGIN ----------------------
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1️⃣ Validate input
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Please provide email and password" });
    }

    // 2️⃣ Find user and include password
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }

    // 3️⃣ Check if verified
    if (!user.isVerified) {
      return res.status(403).json({ success: false, error: "Please verify your account first" });
    }

    // 4️⃣ Compare passwords
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }

    // 5️⃣ Generate JWT
    const token = user.getSignedJwtToken();

    // ✅ Include user info (no password)
    res.status(200).json({
      success: true,
      token,
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

// ---------------------- RESEND OTP ----------------------
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
    res.status(500).json({ success: false, error: "Failed to resend verification code" });
  }
};
