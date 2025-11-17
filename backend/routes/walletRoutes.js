import express from "express";
import { 
  createStaticAccount,
  initiateMonnifyPayment
} from "../controllers/monnifyController.js";
import {
  withdrawFunds,
} from "../controllers/walletController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Create Static Virtual Account
router.get("/create-static-account", createStaticAccount);

// WebView funding (option B)
router.post("/initiate-monnify-payment", initiateMonnifyPayment);

router.post("/withdraw", protect, withdrawFunds);

router.get("/withdraw/history", protect, async (req, res) => {
  const history = await Withdraw.find({ user: req.user.id })
    .sort({ createdAt: -1 });
  res.json({ success: true, history });
});

export default router;
