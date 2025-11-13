import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Define schema
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Please enter your username"],
    },
    email: {
      type: String,
      required: [true, "Please enter your email"],
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, "Please enter your password"],
      minlength: 6,
      select: false, // Hide password by default
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      match: [/^\+?\d{10,15}$/, "Please enter a valid phone number"],
    },
    birthDate: {
      type: Date,
      required: [true, "Date of Birth is required"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    securityPin: {
      type: String,
      select: false,
    },
    securityPinExpires: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true }
);

//
// 🔐 1. Encrypt password before saving
//
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

//
// 🔑 2. Compare entered password with stored hash
//
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

//
// 🪙 3. Sign and return JWT
//
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

//
// 🔢 4. Generate 6-digit security PIN (OTP)
//
userSchema.methods.generateSecurityPin = function () {
  const pin = Math.floor(100000 + Math.random() * 900000).toString(); // e.g. "483920"
  this.securityPin = pin;
  this.securityPinExpires = Date.now() + 10 * 60 * 1000; // 10 minutes from now
  return pin;
};

//
// ✅ Export model
//
export default mongoose.model("User", userSchema);