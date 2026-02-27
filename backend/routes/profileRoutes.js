import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/auth.js";
import {
  updateProfile,
  updateAvatar,
  getNotifications,
  markNotificationsAsRead,
  getReferrals,
} from "../controllers/profileController.js";

const router = Router();

// Multer memory storage (for Cloudinary, Firebase, etc)
const upload = multer({ storage: multer.memoryStorage() });

router.put("/update-profile", protect, updateProfile);

router.get("/notifications", protect, getNotifications);
router.post("/notifications/read", protect, markNotificationsAsRead);
router.get("/referrals", protect, getReferrals);

router.put(
  "/update-avatar",
  protect,
  upload.fields([{ name: "avatar", maxCount: 1 }, { name: "photo", maxCount: 1 }]),
  (req, _res, next) => {
    req.file = req.files?.avatar?.[0] || req.files?.photo?.[0] || null;
    next();
  },
  updateAvatar
);

export default router;
