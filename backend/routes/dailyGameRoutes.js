import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { playDailyGame, claimDailyReward } from "../controllers/dailyGameController.js";

const router = Router();

router.post("/play", protect, playDailyGame);
router.post("/claim", protect, claimDailyReward);

export default router;
