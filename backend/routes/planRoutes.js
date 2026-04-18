// backend/routes/planRoutes.js
import express from "express";
import { getAllPlans, getNetworkPlans, getPlanById } from "../controllers/plansController.js";
import {
  createAdminPlan,
  deactivateAdminPlan,
  listAdminPlans,
  resetPlansToProviderCatalog,
  syncPlansFromProviderCatalog,
  updateAdminPlan,
} from "../controllers/plansAdminController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

// GET all active plans (all networks)
router.get("/", getAllPlans);

// specific routes FIRST
router.get("/single/:plan_id", getPlanById);

// network filter
router.get("/network/:network", getNetworkPlans);

// Admin: sync plans from canonical provider catalog and disable all others.
router.post(
  "/admin/sync-provider-catalog",
  protect,
  authorize("admin"),
  syncPlansFromProviderCatalog
);

// Admin: hard reset plans to provider catalog (deletes legacy plans).
router.post(
  "/admin/reset-provider-catalog",
  protect,
  authorize("admin"),
  resetPlansToProviderCatalog
);

// Admin: plans CRUD
router.get("/admin/plans", protect, authorize("admin"), listAdminPlans);
router.post("/admin/plans", protect, authorize("admin"), createAdminPlan);
router.put("/admin/plans/:plan_id", protect, authorize("admin"), updateAdminPlan);
router.delete("/admin/plans/:plan_id", protect, authorize("admin"), deactivateAdminPlan);

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
