// backend/routes/dataPurchaseRoutes.js
import express from "express";
import { buyData } from "../controllers/dataPurchaseController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// BUY DATA
router.post("/buy", protect, buyData);

export default router;
