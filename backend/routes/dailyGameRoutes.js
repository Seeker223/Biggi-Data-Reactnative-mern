import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { playDailyGame } from "../controllers/dailyGameController.js";

const router = Router();

router.post("/play", protect, playDailyGame);

export default router;
