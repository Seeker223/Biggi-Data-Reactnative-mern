// routes/walletRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getWallet, deposit, withdraw, redeem } = require("../controllers/walletController");

router.get("/", protect, getWallet);
router.post("/deposit", protect, deposit);
router.post("/withdraw", protect, withdraw);
router.post("/redeem", protect, redeem);

module.exports = router;
