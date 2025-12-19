//backend/models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

/* -------------------------------------------
   DAILY GAME SCHEMA
------------------------------------------- */
const DailyGameSchema = new mongoose.Schema({
  numbers: {
    type: [Number],
    required: true,
    validate: {
      validator: (v) => v.length === 5,
      message: "Daily game selection must contain exactly 5 numbers",
    },
  },
  result: { type: [Number], default: [] },
  isWinner: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

/* -------------------------------------------
   WEEKLY GAME SCHEMA
------------------------------------------- */
const WeeklyGameSchema = new mongoose.Schema({
  numbers: { type: [Number], default: [] },
  result: { type: [Number], default: [] },
  isWinner: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

/* -------------------------------------------
   USER SCHEMA
------------------------------------------- */
const UserSchema = new mongoose.Schema(
  {
    /* ---------------- BASIC INFO ---------------- */
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Invalid email",
      ],
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      match: [/^\+?[0-9]{10,15}$/, "Invalid phone number"],
    },

    birthDate: { type: Date, required: true },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    isVerified: { type: Boolean, default: false },

    photo: { type: String, default: null },

    /* ---------------- WALLET ---------------- */
    mainBalance: { type: Number, default: 0 },
    rewardBalance: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    dataBundleCount: { type: Number, default: 0 },

    tickets: { type: Number, default: 0 },
    notifications: { type: Number, default: 0 },

    /* ---------------- GAMES ---------------- */
    dailyNumberDraw: [DailyGameSchema],
    lastDailyGame: { type: Date, default: null },
    weeklyNumberDraw: [WeeklyGameSchema],

    /* ---------------- SECURITY ---------------- */
    securityPin: String,
    securityPinExpires: Date,

    resetPasswordToken: String,
    resetPasswordExpire: Date,

    /* ---------------- REFRESH TOKEN ---------------- */
    refreshToken: {
      type: String,
      select: false,
    },

    /* ---------------- TESTING ---------------- */
    testRef: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

/* ==========================================
   PASSWORD HASHING
========================================== */
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* ==========================================
   MATCH PASSWORD
========================================== */
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/* ==========================================
   ACCESS TOKEN (JWT)
========================================== */
UserSchema.methods.getSignedJwtToken = function () {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in environment variables");
  }

  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "15m",
  });
};

/* ==========================================
   REFRESH TOKEN
========================================== */
UserSchema.methods.getRefreshToken = function () {
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_REFRESH_SECRET is missing in environment variables");
  }

  const refreshToken = jwt.sign(
    { id: this._id },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRE || "7d",
    }
  );

  this.refreshToken = refreshToken;
  return refreshToken;
};

/* ==========================================
   GENERATE OTP / SECURITY PIN
========================================== */
UserSchema.methods.generateSecurityPin = function () {
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  this.securityPin = pin;
  this.securityPinExpires = Date.now() + 10 * 60 * 1000;
  return pin;
};

/* ==========================================
   RESET PASSWORD TOKEN
========================================== */
UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");

  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

/* ==========================================
   AGE (VIRTUAL)
========================================== */
UserSchema.virtual("age").get(function () {
  if (!this.birthDate) return null;

  const today = new Date();
  const birth = new Date(this.birthDate);

  let age = today.getFullYear() - birth.getFullYear();
  const month = today.getMonth() - birth.getMonth();

  if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
});

export default mongoose.model("User", UserSchema);
