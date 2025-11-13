import crypto from "crypto";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";

// ---------------------- REGISTER + AUTO OTP ----------------------
export const register = async (req, res) => {
  try {
    const { username, email, password, phoneNumber, birthDate } = req.body;

    // Check duplicates
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ success: false, error: "Email already registered" });

    // Create user
    const user = await User.create({ username, email, password, phoneNumber, birthDate });

    // Generate 6-digit OTP
    const pin = user.generateSecurityPin();
    await user.save({ validateBeforeSave: false });

    // Send OTP email
    const message = `Welcome ${user.username}!\n\nYour 6-digit verification code is: ${pin}\n\nThis code will expire in 10 minutes.`;

    await sendEmail({
      email: user.email,
      subject: "Verify Your Account (6-digit PIN)",
      message,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully. Verification code sent via email.",
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

    if (!user)
      return res.status(404).json({ success: false, error: "User not found" });

    if (!user.securityPinExpires || user.securityPinExpires < Date.now()) {
      return res.status(400).json({ success: false, error: "PIN expired" });
    }

    if (user.securityPin !== pin)
      return res.status(400).json({ success: false, error: "Invalid PIN" });

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
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, error: "Please provide email and password" });

  const user = await User.findOne({ email }).select("+password");
  if (!user) return res.status(400).json({ success: false, error: "Invalid credentials" });

  if (!user.isVerified)
    return res.status(403).json({ success: false, error: "Please verify your account first" });

  const isMatch = await user.matchPassword(password);
  if (!isMatch) return res.status(400).json({ success: false, error: "Invalid credentials" });

  const token = user.getSignedJwtToken();
  res.status(200).json({ success: true, token });
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

    const message = `Your new verification code is: ${pin}\nIt will expire in 10 minutes.`;

    await sendEmail({
      email: user.email,
      subject: "New Verification Code",
      message,
    });

    res.status(200).json({ success: true, message: "New code sent successfully" });
  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({ success: false, error: "Failed to resend code" });
  }
};
