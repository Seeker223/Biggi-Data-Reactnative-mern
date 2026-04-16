import { Router } from "express";
import { protect } from "../middleware/auth.js";
import {
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

export default router;
