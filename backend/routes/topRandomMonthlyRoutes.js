import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getTopRandomMonthlyStatus,
  getTopRandomMonthlyWinners,
  claimTopRandomMonthlyReward,
} from "../controllers/topRandomMonthlyController.js";

const router = express.Router();

router.get("/status", protect, getTopRandomMonthlyStatus);
router.get("/winners", protect, getTopRandomMonthlyWinners);
router.post("/claim", protect, claimTopRandomMonthlyReward);

export default router;

