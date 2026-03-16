import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  getDepositFeeSettingsAdmin,
  updateDepositFeeSettings,
  listDepositFeeLedger,
  deleteDepositFeeLedgerEntry,
  previewDepositFee,
} from "../controllers/depositFeeAdminController.js";

const router = Router();

router.get("/settings", protect, authorize("admin"), getDepositFeeSettingsAdmin);
router.put("/settings", protect, authorize("admin"), updateDepositFeeSettings);
router.get("/ledger", protect, authorize("admin"), listDepositFeeLedger);
router.delete("/ledger/:id", protect, authorize("admin"), deleteDepositFeeLedgerEntry);
router.get("/preview", protect, authorize("admin"), previewDepositFee);

export default router;
