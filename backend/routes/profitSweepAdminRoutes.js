import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  getProfitSummaryAdmin,
  getProfitSweepSettings,
  listProfitSweeps,
  runProfitSweepNow,
  updateProfitSweepSettings,
} from "../controllers/profitSweepAdminController.js";

const router = Router();

router.get("/summary", protect, authorize("admin"), getProfitSummaryAdmin);
router.get("/settings", protect, authorize("admin"), getProfitSweepSettings);
router.put("/settings", protect, authorize("admin"), updateProfitSweepSettings);
router.get("/sweeps", protect, authorize("admin"), listProfitSweeps);
router.post("/sweep-now", protect, authorize("admin"), runProfitSweepNow);

export default router;

