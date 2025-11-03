// routes/authRoutes.js

const express = require('express');
const { 
    register, 
    login, 
    sendVerificationEmail, 
    confirmVerification,
    forgotPassword,       // ⬅️ NEW: Forgot Password
    resetPassword         // ⬅️ NEW: Reset Password
} = require('../controllers/authController');

const router = express.Router();

// ---------------------- Core Authentication ----------------------
router.post('/register', register);
router.post('/login', login);

// ---------------------- Email Verification ----------------------
// POST: User requests a new verification link
router.post('/verify-email', sendVerificationEmail);         

// GET: User clicks the link in the email to confirm verification
router.get('/confirm-verification/:token', confirmVerification); 

// ---------------------- Password Reset --------------------------
// POST: User sends email to request a reset link
router.post('/forgotpassword', forgotPassword);

// PUT: User uses the token from the email to submit a new password
router.put('/resetpassword/:token', resetPassword); 

module.exports = router;