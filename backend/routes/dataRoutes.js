import { getTopBuyersLeaderboard } from "../controllers/dataController.js";

// Leaderboard (no login required or require login — your choice)
router.get("/leaderboard", protect, getTopBuyersLeaderboard);
