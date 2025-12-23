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
import { protect } from "../middleware/auth.js";

const router = express.Router();

/* ===================== PUBLIC ROUTES ===================== */
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshTokenController);
router.post("/forgot-password", forgotPassword);

/* ===================== PROTECTED ROUTES ===================== */
router.get("/me", protect, getMe);
router.post("/logout", protect, logout);

export default router;