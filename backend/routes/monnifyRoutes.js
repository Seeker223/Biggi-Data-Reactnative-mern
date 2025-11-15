import express from "express";
import { protect } from "../middleware/auth.js";
import { createStaticAccount } from "../controllers/walletController.js";

const router = express.Router();

// static virtual account
router.get("/create-static-account", protect, createStaticAccount);

export default router;


// import express from "express";
// import {
//   createVirtualAccount,
//   manualCredit
// } from "../controllers/monnifyController.js";
// import { protect } from "../middleware/auth.js";

// const router = express.Router();

// // User must be logged in to generate virtual account
// router.post("/create-account", protect, createVirtualAccount);

// // Admin manual credit
// router.post("/manual-credit", manualCredit);

// router.post("/initialize-monnify", protect, initMonnify);
// router.post("/monnify-webhook", monnifyWebhook);


// // ❌ DO NOT PUT WEBHOOK HERE — IT MUST BE IN index.js

// export default router;
