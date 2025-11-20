// backend/routes/planRoutes.js
import express from "express";
import { getNetworkPlans, getPlanById } from "../controllers/plansController.js";

const router = express.Router();

// specific routes FIRST
router.get("/single/:plan_id", getPlanById);

// network filter
router.get("/network/:network", getNetworkPlans);

export default router;



// // backend/routes/planRoutes.js
// import express from "express";
// import {
//   createPlan,
//   updatePlan,
//   deletePlan,
//   getAllPlans,
//   getPlansByCategory,
// } from "../controllers/plansController.js";

// const router = express.Router();

// // Admin (protect in future)
// router.post("/admin/create", createPlan);
// router.put("/admin/update/:id", updatePlan);
// router.delete("/admin/delete/:id", deletePlan);

// // Public
// router.get("/:network/:category", getPlansByCategory);
// router.get("/all", getAllPlans);

// export default router;
