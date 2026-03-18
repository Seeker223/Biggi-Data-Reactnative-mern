import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  getEmailSettings,
  updateEmailSettings,
} from "../controllers/emailSettingsAdminController.js";

const router = Router();

router.get("/", protect, authorize("admin"), getEmailSettings);
router.put("/", protect, authorize("admin"), updateEmailSettings);

export default router;
