//backend/routes/authRoutes.js
import express from "express";
import {
  register,
  login,
  verifySecurityPin,
  resendSecurityPin,
  getMe,
  refreshTokenController,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

/* =======================
   PUBLIC ROUTES
======================= */
router.post("/register", register);
router.post("/login", login);
router.post("/verify-pin", verifySecurityPin);
router.post("/resend-pin", resendSecurityPin);

// 🔁 Refresh access token (public)
router.post("/refresh", refreshTokenController);

/* =======================
   PROTECTED ROUTES
======================= */
router.get("/me", protect, getMe);

export default router;
