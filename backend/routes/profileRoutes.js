import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/auth.js";
import {
  updateProfile,
  updateAvatar,
  getNotifications,
  markNotificationsAsRead,
  getReferrals,
  getReferralLeaderboard,
  getTransactionSecurityStatus,
  setTransactionPin,
  disableTransactionPin,
  verifyTransactionPin,
  requestTransactionPinReset,
  confirmTransactionPinReset,
} from "../controllers/profileController.js";

const router = Router();

// Multer memory storage (for Cloudinary, Firebase, etc)
const upload = multer({ storage: multer.memoryStorage() });

router.put("/update-profile", protect, updateProfile);

router.get("/notifications", protect, getNotifications);
router.post("/notifications/read", protect, markNotificationsAsRead);
router.get("/referrals", protect, getReferrals);
router.get("/referrals/leaderboard", protect, getReferralLeaderboard);
router.get("/transaction-security", protect, getTransactionSecurityStatus);
router.post("/transaction-pin", protect, setTransactionPin);
router.post("/transaction-pin/verify", protect, verifyTransactionPin);
router.delete("/transaction-pin", protect, disableTransactionPin);
router.post("/transaction-pin/reset/request", protect, requestTransactionPinReset);
router.post("/transaction-pin/reset/confirm", protect, confirmTransactionPinReset);

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
