// middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Import the User model

// ---------------------- 1. Protection Middleware ----------------------
// Ensures the user is logged in (has a valid JWT)

exports.protect = async (req, res, next) => {
  let token;

  // 1. Check for token in the Authorization header (Bearer token standard)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    // Example: "Bearer [TOKEN]" -> extract [TOKEN]
    token = req.headers.authorization.split(' ')[1];
  } 
  // Optional: Check for token in cookies (if you chose a cookie-based approach)
  // else if (req.cookies.token) {
  //   token = req.cookies.token;
  // }

  // 2. Make sure token exists
  if (!token) {
    // Use 401 Unauthorized
    return res.status(401).json({ success: false, error: 'Not authorized to access this route, no token provided' });
  }

  try {
    // 3. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 4. Attach user object to the request for use in controllers
    // Exclude the password since the model has `select: false`, but ensure user exists
    req.user = await User.findById(decoded.id);

    if (!req.user) {
        // Token was valid, but user might have been deleted from DB
        return res.status(401).json({ success: false, error: 'User associated with token no longer exists' });
    }
    
    next();
  } catch (err) {
    // This catches expired tokens, bad signatures, etc.
    return res.status(401).json({ success: false, error: 'Not authorized, token is invalid or expired' });
  }
};


// ---------------------- 2. Authorization Middleware ----------------------
// Restricts access based on user role

exports.authorize = (...roles) => {
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