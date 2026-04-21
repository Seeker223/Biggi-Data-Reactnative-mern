import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  adminAdjustBiggiHouseUserWallet,
  adminCreateHouse,
  adminDeleteHouse,
  adminDeleteMembership,
  adminGetWinners,
  adminListHouses,
  adminListMemberships,
  adminListUsers,
  adminOverview,
  adminTriggerPayouts,
  adminTriggerWinnerSelection,
  adminUpdateBiggiHouseConfig,
  adminUpdateHouse,
  adminUpdateUser,
  depositBiggiHouseWallet,
  generateBiggiHouseTxRef,
  getBiggiHouseConfig,
  getBiggiHouseDepositFeeSettings,
  getBiggiHouseEligibility,
  getBiggiHouseHouses,
  getBiggiHouseMemberships,
  getBiggiHouseVirtualAccount,
  getBiggiHouseWallet,
  joinBiggiHouse,
  getBiggiHouseWeeklyCard,
  getBiggiHouseWeeklyCardHistory,
  playBiggiHouseWeeklyCardGame,
  // Backward-compat handlers (aliases)
  getBiggiHouseMonthlyCardHistory,
  playBiggiHouseMonthlyCardGame,
  verifyBiggiHouseFlutterwavePayment,
  withdrawBiggiHouseWallet,
} from "../controllers/biggiHouseController.js";

const router = Router();

// Public config (used by homepage/dashboard; no auth required).
router.get("/config", getBiggiHouseConfig);

router.get("/houses", protect, getBiggiHouseHouses);
router.post("/houses/:id/join", protect, joinBiggiHouse);
router.get("/memberships", protect, getBiggiHouseMemberships);

// Monthly Card Game
router.get("/game/weekly-card/card", protect, getBiggiHouseWeeklyCard);
router.post("/game/weekly-card/play", protect, playBiggiHouseWeeklyCardGame);
router.get("/game/weekly-card/history", protect, getBiggiHouseWeeklyCardHistory);
// Backward-compat routes
router.post("/game/monthly-card/play", protect, playBiggiHouseMonthlyCardGame);
router.get("/game/monthly-card/history", protect, getBiggiHouseMonthlyCardHistory);

router.get("/wallet", protect, getBiggiHouseWallet);
router.post("/wallet/deposit", protect, depositBiggiHouseWallet);
router.post("/wallet/withdraw", protect, withdrawBiggiHouseWallet);
router.get("/wallet/generate-tx-ref", protect, generateBiggiHouseTxRef);
router.get("/wallet/virtual-account", protect, getBiggiHouseVirtualAccount);
router.post("/wallet/verify-flutterwave", protect, verifyBiggiHouseFlutterwavePayment);
router.get("/wallet/deposit-fee-settings", protect, getBiggiHouseDepositFeeSettings);

router.get("/eligibility", protect, getBiggiHouseEligibility);

// Admin C-Panel
router.get("/admin/overview", protect, authorize("admin"), adminOverview);
router.get("/admin/users", protect, authorize("admin"), adminListUsers);
router.patch("/admin/users/:id", protect, authorize("admin"), adminUpdateUser);
router.post("/admin/users/:id/wallet-adjust", protect, authorize("admin"), adminAdjustBiggiHouseUserWallet);

router.patch("/admin/config", protect, authorize("admin"), adminUpdateBiggiHouseConfig);

router.get("/admin/houses", protect, authorize("admin"), adminListHouses);
router.post("/admin/houses", protect, authorize("admin"), adminCreateHouse);
router.patch("/admin/houses/:id", protect, authorize("admin"), adminUpdateHouse);
router.delete("/admin/houses/:id", protect, authorize("admin"), adminDeleteHouse);

router.get("/admin/memberships", protect, authorize("admin"), adminListMemberships);
router.delete("/admin/memberships/:id", protect, authorize("admin"), adminDeleteMembership);

router.get("/admin/winners", protect, authorize("admin"), adminGetWinners);
router.post("/admin/winners/select", protect, authorize("admin"), adminTriggerWinnerSelection);
router.post("/admin/winners/payout", protect, authorize("admin"), adminTriggerPayouts);

export default router;
