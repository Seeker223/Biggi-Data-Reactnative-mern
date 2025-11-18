import express from "express";
import { buyData } from "../controllers/dataBundleController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/buy", protect, buyData);

export default router;
