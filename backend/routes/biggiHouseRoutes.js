import { Router } from "express";
import { protect } from "../middleware/auth.js";
import {
  createBiggiHouseVendorRequest,
  depositBiggiHouseWallet,
  getBiggiHouseEligibility,
  getBiggiHouseHouses,
  getBiggiHouseMemberships,
  getBiggiHouseVendors,
  getBiggiHouseWallet,
  getMerchantBiggiHouseRequests,
  joinBiggiHouse,
  withdrawBiggiHouseWallet,
} from "../controllers/biggiHouseController.js";

const router = Router();

router.get("/houses", protect, getBiggiHouseHouses);
router.post("/houses/:id/join", protect, joinBiggiHouse);
router.get("/memberships", protect, getBiggiHouseMemberships);

router.get("/wallet", protect, getBiggiHouseWallet);
router.post("/wallet/deposit", protect, depositBiggiHouseWallet);
router.post("/wallet/withdraw", protect, withdrawBiggiHouseWallet);

router.get("/eligibility", protect, getBiggiHouseEligibility);

router.get("/vendors", protect, getBiggiHouseVendors);
router.post("/vendor-requests", protect, createBiggiHouseVendorRequest);

router.get("/merchant/requests", protect, getMerchantBiggiHouseRequests);

export default router;
