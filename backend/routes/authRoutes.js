import express from "express";
import {
  register,
  login,
  verifySecurityPin,
  resendSecurityPin,
} from "../controllers/authController.js";
import { testEmail } from "../controllers/testAuthController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-pin", verifySecurityPin);
router.post("/resend-pin", resendSecurityPin);
router.post("/test-email", testEmail) 

export default router;