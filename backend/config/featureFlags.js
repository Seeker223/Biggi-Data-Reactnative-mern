// backend/config/featureFlags.js
// 🚩 Centralized Feature Flags for Play Store Review
// When DISABLE_GAME_AND_REDEEM is true, all reward-awarding and withdrawal endpoints return safe responses.

export const FEATURE_FLAGS = {
  // 🎮 DISABLE_GAME_AND_REDEEM
  // When true:
  //   - Claiming daily rewards returns a safe message
  //   - Claiming monthly rewards returns a safe message
  //   - Withdrawals return a safe message
  //   - Daily game winning numbers are still generated but no prizes awarded
  //   - Redeem rewards returns a safe message
  DISABLE_GAME_AND_REDEEM: process.env.DISABLE_GAME_AND_REDEEM === "true" || true,
};

export default FEATURE_FLAGS;
