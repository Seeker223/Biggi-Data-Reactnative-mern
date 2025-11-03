// routes/userRoutes.js

const express = require('express');
const { 
  getAllUsers, 
  createUser,       // Note: In a production app, user creation is often handled by authRoutes.js (register)
  getUserById, 
  updateUser, 
  deleteUser 
} = require('../controllers/userController');

// Import middleware for protection and authorization
const { protect, authorize } = require('../middleware/auth'); 

const router = express.Router();

// ---------------------- Public & Protected Collection Routes ----------------------

router.route('/')
  // GET: Get all users (Example: make this public for browsing, or protect it)
  .get(protect, authorize('admin', 'publisher'), getAllUsers) 
  
  // POST: Create a new user (Note: Typically handled by the /api/v1/auth/register route)
  .post(createUser); 

// ---------------------- Protected Single Resource Routes ----------------------

router.route('/:id')
  // GET: Get a single user by ID (Protected: Requires login)
  .get(protect, getUserById) 
  
  // PUT: Update a user (Protected: Requires login and specific roles)
  .put(protect, authorize('admin', 'user'), updateUser)
  
  // DELETE: Delete a user (Highly Restricted: Requires Admin role)
  .delete(protect, authorize('admin'), deleteUser);

module.exports = router;