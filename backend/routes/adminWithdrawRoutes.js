import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import { approveWithdrawal, rejectWithdrawal } from "../controllers/withdrawAdminController.js";

const router = Router();

// /api/admin/withdraw/approve/:id
router.put("/withdraw/approve/:id", protect, authorize("admin"), approveWithdrawal);

// /api/admin/withdraw/reject/:id
router.put("/withdraw/reject/:id", protect, authorize("admin"), rejectWithdrawal);

export default router;
