import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Please add a username"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
    },

    email: {
      type: String,
      required: [true, "Please add an email address"],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email address",
      ],
    },

    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false,
    },

    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      match: [/^\+?[0-9]{10,15}$/, "Please provide a valid phone number"],
      sparse: true,
    },

    birthDate: {
      type: Date,
      required: [true, "Date of Birth is required"],
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    // ---------------- NEW FIELDS ----------------

photo: {
  type: String,
  default: null,
},
virtualAccount: {
  type: Array,
  default: [],
},

mainBalance: {
  type: Number,
  default: 0,
},

rewardBalance: {
  type: Number,
  default: 0,
},
// MONNIFY STATIC ACCOUNT
    monnifyVirtualAccount: {
      accountNumber: { type: String, default: null },
      bankName: { type: String, default: null },
    },
totalDeposits: {
  type: Number,
  default: 0,
},

dataBundleCount: {
  type: Number,
  default: 0,
},

tickets: {
  type: Number,
  default: 0,
},

notifications: {
  type: Number,
  default: 0,
},

lastDailyGame: {
  type: Date,
  default: null,
},



    securityPin: String,
    securityPinExpires: Date,

    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------- PASSWORD HASHING ----------------------
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ---------------------- MATCH PASSWORD ----------------------
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ---------------------- SIGN JWT TOKEN ----------------------
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "30d",
  });
};

// ---------------------- GENERATE 6-DIGIT OTP ----------------------
UserSchema.methods.generateSecurityPin = function () {
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  this.securityPin = pin;
  this.securityPinExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
  return pin;
};

// ---------------------- RESET PASSWORD TOKEN ----------------------
UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");

  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
  return resetToken;
};

// ---------------------- VIRTUAL FIELD: AGE ----------------------
UserSchema.virtual("age").get(function () {
  if (!this.birthDate) return null;
  const today = new Date();
  const birthDate = new Date(this.birthDate);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

const User = mongoose.model("User", UserSchema);
export default User;
