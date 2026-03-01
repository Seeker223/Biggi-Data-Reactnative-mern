// backend/routes/authRoutes.js - SIMPLIFIED
import express from "express";
import {
  register,
  login,
  getMe,
  refreshTokenController,
  forgotPassword,
  logout
} from "../controllers/authController.js";
import {
  getBiometricStatus,
  beginBiometricRegistration,
  verifyBiometricRegistration,
  beginBiometricLogin,
  verifyBiometricLogin,
  beginBiometricTransaction,
  verifyBiometricTransaction,
  disableBiometric,
} from "../controllers/biometricController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

/* ===================== PUBLIC ROUTES ===================== */
router.post("/register", register);
router.post("/login", login);
router.post("/biometric/login/options", beginBiometricLogin);
router.post("/biometric/login/verify", verifyBiometricLogin);
router.post("/fingerprint/login/options", beginBiometricLogin);
router.post("/fingerprint/login/verify", verifyBiometricLogin);
router.post("/refresh", refreshTokenController);
router.post("/forgot-password", forgotPassword);

/* ===================== PROTECTED ROUTES ===================== */
router.get("/me", protect, getMe);
router.post("/logout", protect, logout);
router.get("/biometric/status", protect, getBiometricStatus);
router.post("/biometric/register/options", protect, beginBiometricRegistration);
router.post("/biometric/register/verify", protect, verifyBiometricRegistration);
router.post("/biometric/transaction/options", protect, beginBiometricTransaction);
router.post("/biometric/transaction/verify", protect, verifyBiometricTransaction);
router.delete("/biometric", protect, disableBiometric);
router.get("/fingerprint/status", protect, getBiometricStatus);
router.post("/fingerprint/register/options", protect, beginBiometricRegistration);
router.post("/fingerprint/register/verify", protect, verifyBiometricRegistration);
router.post("/fingerprint/transaction/options", protect, beginBiometricTransaction);
router.post("/fingerprint/transaction/verify", protect, verifyBiometricTransaction);
router.delete("/fingerprint", protect, disableBiometric);

export default router;
