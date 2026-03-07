import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import { getAdminDashboard } from "../controllers/adminController.js";

const router = Router();

router.get("/dashboard", protect, authorize("admin"), getAdminDashboard);

export default router;

