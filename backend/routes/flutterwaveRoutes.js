//backend/routes/flutterwaveRoutes.js
import express from "express";
import { flutterwaveWebhook } from "../controllers/flutterwaveController.js";

const router = express.Router();

/**
 * POST /api/v1/flutterwave/webhook
 * Flutterwave server → backend
 * MUST use raw body
 * MUST NOT be protected
 */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  flutterwaveWebhook
);

export default router;
