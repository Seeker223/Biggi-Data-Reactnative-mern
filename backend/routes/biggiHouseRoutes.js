import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  adminCreateHouse,
  adminDeleteHouse,
  adminDeleteMembership,
  adminGetWinners,
  adminListHouses,
  adminListMemberships,
  adminListUsers,
  adminListVendorRequests,
  adminOverview,
  adminTriggerPayouts,
  adminTriggerWinnerSelection,
  adminUpdateHouse,
  adminUpdateUser,
  adminUpdateVendorRequest,
  createBiggiHouseVendorRequest,
  depositBiggiHouseWallet,
  generateBiggiHouseTxRef,
  getBiggiHouseDepositFeeSettings,
  getBiggiHouseEligibility,
  getBiggiHouseHouses,
  getBiggiHouseMemberships,
  getBiggiHouseVendors,
  getBiggiHouseVirtualAccount,
  getBiggiHouseWallet,
  getMerchantBiggiHouseRequests,
  joinBiggiHouse,
  verifyBiggiHouseFlutterwavePayment,
  withdrawBiggiHouseWallet,
} from "../controllers/biggiHouseController.js";

const router = Router();

router.get("/houses", protect, getBiggiHouseHouses);
router.post("/houses/:id/join", protect, joinBiggiHouse);
router.get("/memberships", protect, getBiggiHouseMemberships);

router.get("/wallet", protect, getBiggiHouseWallet);
router.post("/wallet/deposit", protect, depositBiggiHouseWallet);
router.post("/wallet/withdraw", protect, withdrawBiggiHouseWallet);
router.get("/wallet/generate-tx-ref", protect, generateBiggiHouseTxRef);
router.get("/wallet/virtual-account", protect, getBiggiHouseVirtualAccount);
router.post("/wallet/verify-flutterwave", protect, verifyBiggiHouseFlutterwavePayment);
router.get("/wallet/deposit-fee-settings", protect, getBiggiHouseDepositFeeSettings);

router.get("/eligibility", protect, getBiggiHouseEligibility);

router.get("/vendors", protect, getBiggiHouseVendors);
router.post("/vendor-requests", protect, createBiggiHouseVendorRequest);

router.get("/merchant/requests", protect, getMerchantBiggiHouseRequests);

// Admin C-Panel
router.get("/admin/overview", protect, authorize("admin"), adminOverview);
router.get("/admin/users", protect, authorize("admin"), adminListUsers);
router.patch("/admin/users/:id", protect, authorize("admin"), adminUpdateUser);

router.get("/admin/houses", protect, authorize("admin"), adminListHouses);
router.post("/admin/houses", protect, authorize("admin"), adminCreateHouse);
router.patch("/admin/houses/:id", protect, authorize("admin"), adminUpdateHouse);
router.delete("/admin/houses/:id", protect, authorize("admin"), adminDeleteHouse);

router.get("/admin/memberships", protect, authorize("admin"), adminListMemberships);
router.delete("/admin/memberships/:id", protect, authorize("admin"), adminDeleteMembership);

router.get("/admin/vendor-requests", protect, authorize("admin"), adminListVendorRequests);
router.patch(
  "/admin/vendor-requests/:id",
  protect,
  authorize("admin"),
  adminUpdateVendorRequest
);

router.get("/admin/winners", protect, authorize("admin"), adminGetWinners);
router.post("/admin/winners/select", protect, authorize("admin"), adminTriggerWinnerSelection);
router.post("/admin/winners/payout", protect, authorize("admin"), adminTriggerPayouts);

export default router;
