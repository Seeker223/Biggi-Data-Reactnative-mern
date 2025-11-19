import { getTopBuyersLeaderboard } from "../controllers/topBuyersLeaderboardController.js";

// Leaderboard (no login required or require login — your choice)
router.get("/leaderboard", protect, getTopBuyersLeaderboard);
