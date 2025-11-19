import express from "express";
import {
  createPlan,
  updatePlan,
  deletePlan,
  getAllPlans,
  getPlansByCategory,
} from "../controllers/dataplanController.js";

const router = express.Router();

// Admin
router.post("/admin/create", createPlan);
router.put("/admin/update/:id", updatePlan);
router.delete("/admin/delete/:id", deletePlan);

// Public
router.get("/:network/:category", getPlansByCategory);
router.get("/all", getAllPlans);

export default router;
