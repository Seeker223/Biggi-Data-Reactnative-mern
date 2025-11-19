import express from "express";
import { getPlans, buyData } from "../controllers/dataBundleController.js";
import { protect } from "../middleware/auth.js";    // ✅ FIXED PATH
import { getLocalPlans } from "../controllers/planController.js";

const router = express.Router();

// Local static plans
router.get("/plans/:network/:category/local", getLocalPlans);

// Remote live plans from Zenipoint
router.get("/plans/:network/:category/remote", getPlans);

// Default (local)
router.get("/plans/:network/:category", getLocalPlans);

// Buy data
router.post("/buy", protect, buyData);

export default router;
