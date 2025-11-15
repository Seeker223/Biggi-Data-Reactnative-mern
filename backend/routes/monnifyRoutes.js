import express from "express";
import { createStaticAccount } from "../controllers/monnifyController.js";

const router = express.Router();

// STATIC VIRTUAL ACCOUNT
router.get("/create-static-account", createStaticAccount);

// ❌ Do NOT put the webhook here
// webhook is handled directly in index.js using express.raw()

export default router;



