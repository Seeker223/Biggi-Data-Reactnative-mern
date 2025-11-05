// controllers/userController.js (Converted to ESM)

import User from '../models/User.js'; // MUST include .js extension
import APIFeatures from '../utils/APIFeatures.js'; // MUST include .js extension

// ---------------------- READ Operations ----------------------

// @desc    Get all users with advanced query features (Filter, Sort, Paginate)
// @route   GET /api/v1/users?role=...&sort=...&page=...
// @access  Protected/Admin, Publisher
export const getAllUsers = async (req, res) => {
    try {
        // 1. Initialize APIFeatures with the base query and request query parameters
        // We select '-password' to prevent sending the hash even if someone bypasses 'select: false' in the model
        const features = new APIFeatures(User.find().select('-password -__v'), req.query)
            .filter()
            .sort()
            .paginate();

        // 2. Execute the query
        const users = await features.query;
        
        // NOTE: For full pagination, you should also calculate the total number of documents (User.countDocuments()) 
        // without the limit/skip to send back the total pages for the frontend.

        res.status(200).json({ 
            success: true, 
            count: users.length,
            data: users 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


// @desc    Get single user by ID
// @route   GET /api/v1/users/:id
// @access  Protected
export const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-__v -password');
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        // This will be caught by the error.js middleware for a Mongoose CastError (invalid ID format)
        res.status(400).json({ success: false, error: 'Invalid ID format or Server Error' });
    }
};


// ---------------------- CREATE Operation ----------------------

// @desc    Create a new user
// @route   POST /api/v1/users
// @access  Public (Typically handled by auth/register)
export const createUser = async (req, res) => {
    try {
        // The password will be automatically hashed by the Mongoose pre-save hook
        const user = await User.create(req.body); 

        // Return the created user, excluding the password from the final JSON
        const userResponse = user.toJSON();
        delete userResponse.password;

        res.status(201).json({ success: true, data: userResponse }); 
    } catch (error) {
        // This relies on the central error handler (error.js) to catch validation/duplicate errors
        res.status(400).json({ success: false, error: error.message });
    }
};


// ---------------------- UPDATE Operation ----------------------

// @desc    Update a user
// @route   PUT /api/v1/users/:id
// @access  Protected/Admin, User
export const updateUser = async (req, res) => {
    try {
        // SECURITY CHECK: Do not allow password or role updates via a generic PUT route
        const updateData = { ...req.body };
        delete updateData.password; 
        delete updateData.role; 

        // FindByIdAndUpdate returns the document after applying the update ({ new: true })
        const user = await User.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true, // Re-run schema validation on update
        }).select('-password'); // Ensure password is excluded from the response

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// ---------------------- DELETE Operation ----------------------

// @desc    Delete a user
// @route   DELETE /api/v1/users/:id
// @access  Protected/Admin
export const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // Send a 204 No Content status for a successful deletion (or 200 with empty object)
        res.status(200).json({ success: true, data: {} }); 
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};