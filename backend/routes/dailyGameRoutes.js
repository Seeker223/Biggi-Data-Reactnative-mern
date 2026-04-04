import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { playDailyGame, claimDailyReward, getWeeklyWinners, getMerchantWeeklyCard, getMerchantWeeklyWinners } from "../controllers/dailyGameController.js";

const router = Router();

router.post("/play", protect, playDailyGame);
router.post("/claim", protect, claimDailyReward);
router.get("/winners", protect, getWeeklyWinners);
router.get("/merchant-card", protect, getMerchantWeeklyCard);
router.get("/merchant-winners", protect, getMerchantWeeklyWinners);

export default router;
