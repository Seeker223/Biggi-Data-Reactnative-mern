// backend/models/User.js - UPDATED WITHOUT OTP FIELDS
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
  prizeAmount: { type: Number, default: 2000 },
  claimed: { type: Boolean, default: false },
  claimedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

/* -------------------------------------------
   MONTHLY DRAW SCHEMA
------------------------------------------- */
const MonthlyDrawSchema = new mongoose.Schema({
  month: { type: String, required: true }, // Format: "YYYY-MM"
  purchasesCount: { type: Number, default: 0 },
  isEligible: { type: Boolean, default: false },
  isWinner: { type: Boolean, default: false },
  prizeAmount: { type: Number, default: 5000 },
  claimed: { type: Boolean, default: false },
  claimedAt: { type: Date, default: null },
  lastPurchaseDate: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

/* -------------------------------------------
   TOP RANDOM MONTHLY PICKS SCHEMA
------------------------------------------- */
const TopRandomMonthlyPickSchema = new mongoose.Schema({
  month: { type: String, required: true }, // Format: "YYYY-MM"
  isWinner: { type: Boolean, default: false },
  prizeAmount: { type: Number, default: 2000 },
  claimed: { type: Boolean, default: false },
  claimedAt: { type: Date, default: null },
  selectedAt: { type: Date, default: Date.now },
});

/* -------------------------------------------
   USER NOTIFICATION SCHEMA
------------------------------------------- */
const UserNotificationSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Notification" },
    message: { type: String, required: true },
    amount: { type: Number, default: null },
    status: { type: String, default: "info" },
    seen: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

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

    state: {
      type: String,
      required: true,
      enum: [
        "Abia",
        "Adamawa",
        "Akwa Ibom",
        "Anambra",
        "Bauchi",
        "Bayelsa",
        "Benue",
        "Borno",
        "Cross River",
        "Delta",
        "Ebonyi",
        "Edo",
        "Ekiti",
        "Enugu",
        "Gombe",
        "Imo",
        "Jigawa",
        "Kaduna",
        "Kano",
        "Katsina",
        "Kebbi",
        "Kogi",
        "Kwara",
        "Lagos",
        "Nasarawa",
        "Niger",
        "Ogun",
        "Ondo",
        "Osun",
        "Oyo",
        "Plateau",
        "Rivers",
        "Sokoto",
        "Taraba",
        "Yobe",
        "Abuja",
        "Zamfara",
      ],
    },

    referralCode: {
      type: String,
      unique: true,
      index: true,
    },

    referredByCode: {
      type: String,
      default: null,
    },

    referralRewardedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    userRole: {
      type: String,
      enum: ["private", "merchant"],
      default: null,
    },

    isVerified: { 
      type: Boolean, 
      default: true  // Changed from false to true for MVP
    },

    verifiedAt: { type: Date, default: null },

    photo: { type: String, default: null },

    /* ---------------- WALLET ---------------- */
    mainBalance: { type: Number, default: 0 },
    rewardBalance: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    dataBundleCount: { type: Number, default: 0 },

    tickets: { type: Number, default: 0 },
    notifications: { type: Number, default: 0 },
    notificationItems: [UserNotificationSchema],

    /* ---------------- GAMES ---------------- */
    dailyNumberDraw: [DailyGameSchema],
    lastDailyGame: { type: Date, default: null },
    
    monthlyDraws: [MonthlyDrawSchema],
    topRandomMonthlyPicks: [TopRandomMonthlyPickSchema],
    currentMonthPurchases: { type: Number, default: 0 },
    currentMonthEligible: { type: Boolean, default: false },
    
    /* ---------------- STATISTICS ---------------- */
    totalWins: { type: Number, default: 0 },
    totalPrizeWon: { type: Number, default: 0 },
    lastWinDate: { type: Date, default: null },
    
    /* ---------------- SECURITY ---------------- */
    // REMOVED: securityPin, securityPinExpires
    
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    /* ---------------- REFRESH TOKEN ---------------- */
    refreshToken: {
      type: String,
      select: false,
    },

    /* ---------------- TIMESTAMPS ---------------- */
    lastLogin: { type: Date, default: null },
    lastLogout: { type: Date, default: null },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

/* ==========================================
   VIRTUAL: CURRENT MONTH ELIGIBILITY
========================================== */
UserSchema.virtual('currentMonthProgress').get(function() {
  const purchases = this.currentMonthPurchases || 0;
  const required = 5;
  return {
    purchases,
    required,
    progress: Math.min(100, (purchases / required) * 100),
    isEligible: purchases >= required
  };
});

/* ==========================================
   VIRTUAL: UNCLAIMED REWARDS
========================================== */
UserSchema.virtual('unclaimedRewards').get(function() {
  const dailyUnclaimed = this.dailyNumberDraw
    .filter(game => game.isWinner && !game.claimed)
    .reduce((sum, game) => sum + game.prizeAmount, 0);
    
  const monthlyUnclaimed = this.monthlyDraws
    .filter(draw => draw.isWinner && !draw.claimed)
    .reduce((sum, draw) => sum + draw.prizeAmount, 0);

  const topRandomUnclaimed = this.topRandomMonthlyPicks
    .filter(pick => pick.isWinner && !pick.claimed)
    .reduce((sum, pick) => sum + pick.prizeAmount, 0);
    
  return dailyUnclaimed + monthlyUnclaimed + topRandomUnclaimed;
});

/* ==========================================
   VIRTUAL: TOTAL WINS COUNT
========================================== */
UserSchema.virtual('winsCount').get(function() {
  const dailyWins = this.dailyNumberDraw.filter(game => game.isWinner).length;
  const monthlyWins = this.monthlyDraws.filter(draw => draw.isWinner).length;
  const topRandomWins = this.topRandomMonthlyPicks.filter(pick => pick.isWinner).length;
  return dailyWins + monthlyWins + topRandomWins;
});

/* ==========================================
   VIRTUAL: AGE
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

/* ==========================================
   METHOD: GET CURRENT MONTH STRING
========================================== */
UserSchema.methods.getCurrentMonthString = function() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/* ==========================================
   METHOD: UPDATE MONTHLY PURCHASE
========================================== */
UserSchema.methods.updateMonthlyPurchase = function() {
  const currentMonth = this.getCurrentMonthString();
  let monthlyDraw = this.monthlyDraws.find(d => d.month === currentMonth);
  
  if (!monthlyDraw) {
    monthlyDraw = {
      month: currentMonth,
      purchasesCount: 1,
      isEligible: false,
      isWinner: false,
      prizeAmount: 5000,
      claimed: false
    };
    this.monthlyDraws.push(monthlyDraw);
  } else {
    monthlyDraw.purchasesCount += 1;
    monthlyDraw.lastPurchaseDate = new Date();
    monthlyDraw.updatedAt = new Date();
  }
  
  // Update current month purchases
  this.currentMonthPurchases = monthlyDraw.purchasesCount;
  this.currentMonthEligible = monthlyDraw.purchasesCount >= 5;
  monthlyDraw.isEligible = this.currentMonthEligible;
  
  // Update data bundle count
  this.dataBundleCount += 1;
  
  return this.save();
};

/* ==========================================
   METHOD: CLAIM DAILY REWARD
========================================== */
UserSchema.methods.claimDailyReward = function(gameId) {
  const game = this.dailyNumberDraw.id(gameId);
  if (!game || !game.isWinner || game.claimed) {
    return false;
  }
  
  game.claimed = true;
  game.claimedAt = new Date();
  this.rewardBalance += game.prizeAmount;
  this.totalPrizeWon += game.prizeAmount;
  
  return this.save();
};

/* ==========================================
   METHOD: CLAIM MONTHLY REWARD
========================================== */
UserSchema.methods.claimMonthlyReward = function(month) {
  const monthlyDraw = this.monthlyDraws.find(d => d.month === month);
  if (!monthlyDraw || !monthlyDraw.isWinner || monthlyDraw.claimed) {
    return false;
  }
  
  monthlyDraw.claimed = true;
  monthlyDraw.claimedAt = new Date();
  this.rewardBalance += monthlyDraw.prizeAmount;
  this.totalPrizeWon += monthlyDraw.prizeAmount;
  this.totalWins += 1;
  
  return this.save();
};

/* ==========================================
   METHOD: ADD NOTIFICATION
========================================== */
UserSchema.methods.addNotification = function(payload = {}) {
  const item = {
    type: payload.type || "Notification",
    message: payload.message || "New notification",
    amount: payload.amount ?? null,
    status: payload.status || "info",
    seen: false,
    createdAt: new Date(),
  };

  this.notificationItems = [item, ...(this.notificationItems || [])].slice(0, 100);
  this.notifications = Number(this.notifications || 0) + 1;
  return this;
};

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
   REMOVED: generateSecurityPin method
========================================== */

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

export default mongoose.model("User", UserSchema);
