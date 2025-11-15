import express from "express";
import { 
  createStaticAccount,
  initiateMonnifyPayment
} from "../controllers/monnifyController.js";

const router = express.Router();

// Create Static Virtual Account
router.get("/create-static-account", createStaticAccount);

// WebView funding (option B)
router.post("/initiate-monnify-payment", initiateMonnifyPayment);

export default router;
