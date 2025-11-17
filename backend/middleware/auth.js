// middleware/auth.js (Converted to ESM)

import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // MUST include .js extension for Mongoose model

// ---------------------- 1. Protection Middleware ----------------------
// Ensures the user is logged in (has a valid JWT)

export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, error: "Not authorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // attach minimal user info (id) to req.user
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    console.error("Protect middleware error:", err);
    return res.status(401).json({ success: false, error: "Token invalid" });
  }
};


// ---------------------- 2. Authorization Middleware ----------------------
// Restricts access based on user role

export const authorize = (...roles) => {
    return (req, res, next) => {
        // The req.user object is guaranteed to exist here because 'protect' runs first
        
        if (!roles.includes(req.user.role)) {
            // Use 403 Forbidden
            return res.status(403).json({
                success: false,
                error: `User role (${req.user.role}) is not authorized to access this resource`,
            });
        }
        
        next();
    };
};