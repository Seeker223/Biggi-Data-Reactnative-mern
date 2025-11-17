// backend/routes/authRoutes.js
import express from "express";
import {
  register,
  login,
  verifySecurityPin,
  resendSecurityPin,
  getMe,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js"; // adjust path if needed

const router = express.Router();

// public
router.post("/register", register);
router.post("/login", login);
router.post("/verify-pin", verifySecurityPin);
router.post("/resend-pin", resendSecurityPin);

// protected
router.get("/me", protect, getMe);

export default router;
