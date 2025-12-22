// backend/routes/userRoutes.js

import { Router } from "express";

// Controllers
import {
    getAllUsers,
    createUser,
    getUserById,
    updateUser,
    deleteUser,
    getMe,
} from "../controllers/userController.js";

// Middleware
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

/**
 * @route   GET /api/users/me
 * @desc    Get logged-in user's profile
 * @access  Private
 */
router.get("/me", protect, getMe);


/**
 * @route   GET /api/users
 * @desc    Admin: Get all users
 * @access  Private/Admin
 */
router.get("/", protect, authorize("admin"), getAllUsers);


/**
 * @route   POST /api/users
 * @desc    Admin: Create a new user
 * @access  Private/Admin
 */
router.post("/", protect, authorize("admin"), createUser);


/**
 * @route   GET /api/users/:id
 * @desc    Get single user by ID
 * @access  Private
 */
router.get("/:id", protect, getUserById);


/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Private (user can update own profile) / Admin
 */
router.put("/:id", protect, updateUser);


/**
 * @route   DELETE /api/users/:id
 * @desc    Admin: Delete user
 * @access  Private/Admin
 */
router.delete("/:id", protect, authorize("admin"), deleteUser);

export default router;
