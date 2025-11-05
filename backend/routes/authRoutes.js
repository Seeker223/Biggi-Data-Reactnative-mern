// routes/authRoutes.js (Converted to ESM)

import { Router } from 'express'; // Use import, not require
import { 
    register, 
    login, 
    sendVerificationEmail, 
    confirmVerification,
    forgotPassword, 
    resetPassword,
    // Note: If sendSecurityPin and verifySecurityPin are also named exports, add them here
    sendSecurityPin,
    verifySecurityPin
} from '../controllers/authController.js'; // MUST include .js extension

const router = Router(); // Use Router from the import

// ---------------------- Core Authentication ----------------------
router.post('/register', register);
router.post('/login', login);
router.post("/send-pin", sendSecurityPin);
router.post("/verify-pin", verifySecurityPin);

// ---------------------- Email Verification ----------------------
router.post('/verify-email', sendVerificationEmail);         
router.get('/confirm-verification/:token', confirmVerification); 

// ---------------------- Password Reset --------------------------
router.post('/forgotpassword', forgotPassword);
router.put('/resetpassword/:token', resetPassword); 

// Use ESM default export
export default router;