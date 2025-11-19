// middleware/auth.js (Converted to ESM)

import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // MUST include .js extension for Mongoose model

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

    // Fetch minimal user info (role) to support authorize middleware.
    const user = await User.findById(decoded.id).select('role'); 
    if (!user) {
      return res.status(401).json({ success: false, error: "User not found" });
    }

    req.user = { id: decoded.id, role: user.role };
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
    // req.user should exist because protect runs first
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        error: 'User role not found. Access denied.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role (${req.user.role}) is not authorized to access this resource`,
      });
    }

    next();
  };
};
