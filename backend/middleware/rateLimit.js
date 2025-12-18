// backend/middleware/rateLimit.js
import rateLimit from "express-rate-limit";

/**
 * Rate limiter for payment endpoints per authenticated user
 */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per user
  message: {
    success: false,
    message: "Too many payment requests. Try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,

  // Use user ID as key instead of IP
  keyGenerator: (req, res) => {
    return req.user?._id?.toString() || req.ip;
  },
});
