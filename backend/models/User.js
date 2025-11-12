// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, "Username is required"],
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please provide a valid email address",
    ],
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6,
    select: false,
  },
  role: {
    type: String,
    enum: ["user", "publisher", "admin"],
    default: "user",
  },

  // 🆕 Profile Photo (used on HomeScreen)
  photo: {
    type: String,
    default: "https://i.pravatar.cc/150?img=15",
  },
phoneNumber: {
  type: String,
  required: false,
  unique: true,
  trim: true,
  match: [/^\+?[0-9]{7,15}$/, "Please enter a valid phone number"],
},

birthDate: {
  type: Date,
  required: false,
},

  // For one-to-many relationship
  wallets: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
    },
  ],

  // Verification / Reset fields
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  verificationTokenExpire: Date,
  passwordResetToken: String,
  passwordResetExpire: Date,

  createdAt: { type: Date, default: Date.now },
});

// Password encryption
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Methods
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.getVerificationToken = function () {
  const token = crypto.randomBytes(32).toString("hex");
  this.verificationToken = crypto.createHash("sha256").update(token).digest("hex");
  this.verificationTokenExpire = Date.now() + 10 * 60 * 1000;
  return token;
};

userSchema.methods.getPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");
  this.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  this.passwordResetExpire = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

const User = mongoose.model("User", userSchema);
export default User;


// // models/User.js (Converted to ESM)

// import mongoose from 'mongoose';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';
// import crypto from 'crypto'; // Built-in Node module

// const userSchema = new mongoose.Schema({
//     username: {
//         type: String,
//         required: [true, 'Username is required'],
//         unique: true,
//         trim: true,
//     },
//     email: {
//         type: String,
//         required: [true, 'Email is required'],
//         unique: true,
//         lowercase: true,
//         match: [
//             /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
//             'Please fill a valid email address',
//         ],
//     },
//     password: {
//         type: String,
//         required: [true, 'Password is required'],
//         minlength: 6,
//         select: false, // Don't return password hash by default
//     },
//     role: {
//         type: String,
//         enum: ['user', 'publisher', 'admin'],
//         default: 'user',
//     },
    
//     // Fields for Email Verification
//     isVerified: {
//         type: Boolean,
//         default: false,
//     },
//     verificationToken: String, // Hashed token saved to DB
//     verificationTokenExpire: Date,
    
//     // Fields for Password Reset
//     passwordResetToken: String, // Hashed token saved to DB
//     passwordResetExpire: Date,
    
//     createdAt: {
//         type: Date,
//         default: Date.now,
//     },
// });

// // ---------------------- SCHEMA MIDDLEWARE (Hooks) ----------------------

// // Encrypt password using bcryptjs BEFORE saving the document
// userSchema.pre('save', async function (next) {
//     // Only run this function if password was actually modified (or is new)
//     if (!this.isModified('password')) {
//         return next();
//     }

//     const salt = await bcrypt.genSalt(10);
//     this.password = await bcrypt.hash(this.password, salt);
//     next();
// });

// // ---------------------- SCHEMA METHODS ----------------------

// // Method to generate a signed JWT (token)
// userSchema.methods.getSignedJwtToken = function () {
//     return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
//         expiresIn: process.env.JWT_EXPIRE,
//     });
// };

// // Method to compare entered password to hashed password in the database
// userSchema.methods.matchPassword = async function (enteredPassword) {
//     return await bcrypt.compare(enteredPassword, this.password);
// };

// // Method to generate a random token for email verification
// userSchema.methods.getVerificationToken = function() {
//     // Generate raw token (will be sent in email)
//     const token = crypto.randomBytes(32).toString('hex');

//     // Hash the token and save the hash to the DB (for security comparison)
//     this.verificationToken = crypto
//         .createHash('sha256')
//         .update(token)
//         .digest('hex');

//     // Set expiration time (e.g., 10 minutes)
//     this.verificationTokenExpire = Date.now() + 10 * 60 * 1000; 

//     // Return the unhashed token to be sent in the email URL
//     return token;
// };

// // Method to generate a random token for password reset
// userSchema.methods.getPasswordResetToken = function() {
//     // Generate raw token
//     const resetToken = crypto.randomBytes(20).toString('hex');

//     // Hash the token and save the hash to the DB
//     this.passwordResetToken = crypto
//         .createHash('sha256')
//         .update(resetToken)
//         .digest('hex');

//     // Set expiration time (e.g., 10 minutes)
//     this.passwordResetExpire = Date.now() + 10 * 60 * 1000; 

//     // Return the unhashed token to be sent in the email URL
//     return resetToken;
// };


// // Use 'export default' for the Mongoose model in ESM
// const User = mongoose.model('User', userSchema);
// export default User;