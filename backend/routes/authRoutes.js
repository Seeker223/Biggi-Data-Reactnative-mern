import express from "express";
import {
  register,
  login,
  verifySecurityPin,
  resendSecurityPin,
} from "../controllers/authController.js";

const router = express.Router();

// 🔐 Auth routes
router.post("/register", register);
router.post("/login", login);
router.post("/verify-pin", verifySecurityPin);
router.post("/resend-pin", resendSecurityPin);

export default router;
