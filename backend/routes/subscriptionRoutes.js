import { Router } from "express";
import { protect } from "../middleware/auth.js";
import {
  cancelSubscription,
  getSubscriptionStatus,
  renewSubscription,
  subscribe,
} from "../controllers/biggiHouseController.js";

const router = Router();

router.get("/status", protect, getSubscriptionStatus);
router.post("/subscribe", protect, subscribe);
router.post("/cancel", protect, cancelSubscription);
router.post("/renew", protect, renewSubscription);

export default router;
