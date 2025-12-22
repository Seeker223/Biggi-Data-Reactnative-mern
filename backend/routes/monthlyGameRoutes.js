import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getMonthlyEligibility,
  getMonthlyWinners,
  claimMonthlyReward,
  updateMonthlyPurchase,
} from "../controllers/monthlyGameController.js";

const router = express.Router();

// Get user's monthly eligibility
router.get("/eligibility", protect, getMonthlyEligibility);

// Get monthly winners
router.get("/winners", protect, getMonthlyWinners);

// Claim monthly reward
router.post("/claim", protect, claimMonthlyReward);

// Update monthly purchase count
router.post("/purchase", protect, updateMonthlyPurchase);

export default router;