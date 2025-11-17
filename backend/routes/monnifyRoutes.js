import express from "express";
import { protect } from "../middleware/auth.js";
import { createStaticAccount } from "../controllers/monnifyController.js";

const router = express.Router();

// CREATE STATIC VIRTUAL ACCOUNT (Protected Route)
router.get("/create-static-account", protect, createStaticAccount);

export default router;
