// backend/middleware/rateLimit.js
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate limiter for payment endpoints per authenticated user
 * - Uses user ID when available
 * - Falls back to IP (IPv4/IPv6 safe) if no user ID
 */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per user/IP
  message: {
    success: false,
    message: "Too many payment requests. Try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req, res) => {
    // Use user ID if logged in, otherwise fall back to IPv4/IPv6-safe IP
    return req.user?._id?.toString() || ipKeyGenerator(req, res);
  },
});
