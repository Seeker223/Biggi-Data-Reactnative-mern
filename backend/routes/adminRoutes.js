import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  createAdminUser,
  deleteAdminUser,
  getAdminDashboard,
  getAdminUnmatchedDeposits,
  assignUnmatchedDeposit,
  getAdminUserById,
  getAdminUsers,
  updateAdminUser,
  getDepositCreditLogs,
  getMerchantDataPurchases,
} from "../controllers/adminController.js";

const router = Router();

router.get("/dashboard", protect, authorize("admin"), getAdminDashboard);
router.get("/unmatched-deposits", protect, authorize("admin"), getAdminUnmatchedDeposits);
router.post("/unmatched-deposits/:id/assign", protect, authorize("admin"), assignUnmatchedDeposit);
router.get("/deposit-credit-logs", protect, authorize("admin"), getDepositCreditLogs);
router.get("/merchant-data-purchases", protect, authorize("admin"), getMerchantDataPurchases);
router.get("/users", protect, authorize("admin"), getAdminUsers);
router.get("/users/:id", protect, authorize("admin"), getAdminUserById);
router.post("/users", protect, authorize("admin"), createAdminUser);
router.put("/users/:id", protect, authorize("admin"), updateAdminUser);
router.delete("/users/:id", protect, authorize("admin"), deleteAdminUser);

export default router;
