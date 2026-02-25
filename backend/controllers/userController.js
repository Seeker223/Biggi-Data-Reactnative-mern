// backend/controllers/userController.js
import User from '../models/User.js';
import APIFeatures from '../utils/APIFeatures.js';

// --------------------------------------------------
// @desc    Get logged-in user profile
// @route   GET /api/users/me
// @access  Private
// --------------------------------------------------
export const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -__v');
        if (!user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


// ---------------------- READ Operations ----------------------

// @desc    Get all users (with filtering, sorting, pagination)
// @route   GET /api/users
// @access  Protected/Admin
export const getAllUsers = async (req, res) => {
    try {
        const features = new APIFeatures(
            User.find().select('-password -__v'),
            req.query
        )
            .filter()
            .sort()
            .paginate();

        const users = await features.query;

        res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


// @desc    Get single user by ID
// @route   GET /api/users/:id
// @access  Protected
export const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -__v');
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: "Invalid ID format or Server Error"
        });
    }
};


// ---------------------- CREATE Operation ----------------------

// @desc    Create a new user
// @route   POST /api/users
// @access  Public (normally via auth/register)
export const createUser = async (req, res) => {
    try {
        const user = await User.create(req.body);

        const userResponse = user.toJSON();
        delete userResponse.password;

        res.status(201).json({
            success: true,
            data: userResponse
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};


// ---------------------- UPDATE Operation ----------------------

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Protected/Admin, or user can update own info
export const updateUser = async (req, res) => {
    try {
        const updateData = { ...req.body };
        delete updateData.password;
        delete updateData.role;
        if (updateData.userRole) {
            const normalizedRole = String(updateData.userRole).toLowerCase().trim();
            if (!["private", "merchant"].includes(normalizedRole)) {
                delete updateData.userRole;
            } else {
                updateData.userRole = normalizedRole;
            }
        }

        const user = await User.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        }).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};


// ---------------------- DELETE Operation ----------------------

// @desc    Delete a user
// @route   DELETE /api/users/:id
// @access  Protected/Admin
export const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Server Error"
        });
    }
};
