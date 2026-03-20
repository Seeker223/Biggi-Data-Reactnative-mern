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
  DISABLE_GAME_AND_REDEEM: process.env.DISABLE_GAME_AND_REDEEM === "true" || false,

  // Virtual account mode: static vs dynamic
  // If USE_STATIC_VIRTUAL_ACCOUNT is set, it takes priority.
  USE_STATIC_VIRTUAL_ACCOUNT: process.env.USE_STATIC_VIRTUAL_ACCOUNT
    ? process.env.USE_STATIC_VIRTUAL_ACCOUNT === "true"
    : undefined,
  DISABLE_STATIC_VIRTUAL_ACCOUNT:
    process.env.DISABLE_STATIC_VIRTUAL_ACCOUNT === "true" || false,
};

export default FEATURE_FLAGS;
