import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getMonthlyEligibility,
  getMonthlyWinners,
  claimMonthlyReward,
  updateMonthlyPurchase,
  getMonthlyRaffleTickets,
  playMonthlyRaffleTicket,
  getTopPurchasersLeaderboard,
} from "../controllers/monthlyGameController.js";

const router = express.Router();

// Get user's monthly eligibility
router.get("/eligibility", protect, getMonthlyEligibility);

// User raffle tickets for month
router.get("/tickets", protect, getMonthlyRaffleTickets);

// Play a raffle ticket (creates a pending entry)
router.post("/play", protect, playMonthlyRaffleTicket);

// Top purchases leaderboard
router.get("/top-purchases", protect, getTopPurchasersLeaderboard);

// Get monthly entries + winner
router.get("/winners", protect, getMonthlyWinners);

// Claim monthly reward (winner only)
router.post("/claim", protect, claimMonthlyReward);

// Disabled: purchases update automatically on successful buy-data
router.post("/purchase", protect, updateMonthlyPurchase);

export default router;
