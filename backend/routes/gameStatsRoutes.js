import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getUserGameStats,
  getGameAnalytics,
} from "../controllers/gameStatsController.js";

const router = express.Router();

// Get user's game statistics
router.get("/user", protect, getUserGameStats);

// Get game analytics
router.get("/analytics/:period", protect, getGameAnalytics);

export default router;