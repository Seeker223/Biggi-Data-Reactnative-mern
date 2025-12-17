//backend/routes/flutterwaveRoutes.js
import express from "express";
import { flutterwaveWebhook } from "../controllers/flutterwaveController.js";

const router = express.Router();

router.post("/webhook", express.raw({ type: "application/json" }), flutterwaveWebhook);

export default router;

