// routes/walletRoutes.js
import express from "express";
import { getUserWallet } from "../controllers/walletController.js";

const router = express.Router();

// GET /api/v1/wallet
router.get("/", getUserWallet);

export default router;
