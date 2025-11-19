import express from "express";
import { buyData } from "../controllers/dataPurchaseController.js";

const router = express.Router();

router.post("/buy", buyData);

export default router;
