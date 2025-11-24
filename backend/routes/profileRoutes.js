import { Router } from "express";
import multer from "multer";
import { protect } from "../middleware/auth.js";
import { updateProfile, updateAvatar } from "../controllers/profileController.js";

const router = Router();

// Multer memory storage (for Cloudinary, Firebase, etc)
const upload = multer({ storage: multer.memoryStorage() });

router.put("/update-profile", protect, updateProfile);

router.put(
  "/update-avatar",
  protect,
  upload.single("avatar"),
  updateAvatar
);

export default router;
