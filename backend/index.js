// index.js

// Node.js ES Modules (ESM) require the full file extension for local imports.

import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet'; // Security headers
import cors from 'cors';     // Cross-Origin Resource Sharing
import cookieParser from 'cookie-parser'; // To read JWT from cookies
import hpp from 'hpp'; // HTTP Parameter Pollution protection
import "dotenv/config"; // 1. Correctly loads environment variables for ESM

import job from "./utils/cron.js";

// Route files
import authRoutes from './routes/authRoutes.js'; // This is now correct
import userRoutes from './routes/userRoutes.js'; // This is now correct

// 3. Import the error handler middleware using dynamic import, 
//    or ensure your middleware uses ESM export. Assuming it exports default.
//    If your middleware/error.js is CommonJS (module.exports), use dynamic import:
const { default: errorHandler } = await import('./middleware/error.js'); 

job.start()
const app = express();

// --- 3. CRUCIAL RENDER CONFIGURATION ---
// Server MUST bind to 0.0.0.0 and use Render's PORT environment variable.
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; 

// ---------------------- 2. Database Connection ----------------------

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connection established successfully. 🚀'))
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1); // Exit process if connection fails
  });

// ---------------------- 3. Middleware Stack ----------------------

// Body Parser for JSON data
app.use(express.json());

// Cookie Parser
app.use(cookieParser());

// Enable CORS
// IMPORTANT: Update 'YOUR_FRONTEND_URL' before deployment
app.use(cors({
    origin: process.env.NODE_ENV === 'development' ? '*' : 'YOUR_FRONTEND_URL',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, 
}));

// Set security headers using Helmet
app.use(helmet());

// Protect against HTTP Parameter Pollution
app.use(hpp()); 


// ---------------------- 4. Mount Routes (API Versioning) ----------------------

app.get('/', (req, res) => {
  res.send('API is running... Status: OK');
});

// Authentication routes
app.use('/api/v1/auth', authRoutes);

// User routes
app.use('/api/v1/users', userRoutes);


// ---------------------- 5. Error & Fallback Handlers ----------------------

// Handle requests for non-existent routes (404 Not Found)
// This must be placed before the final errorHandler
app.use((req, res, next) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.originalUrl}` });
});

// Centralized Error Handler Middleware (MUST be the last thing loaded)
app.use(errorHandler);


// ---------------------- 6. Start Server ----------------------

const server = app.listen(
    // Use the correctly defined PORT and HOST
    PORT, 
    HOST,
    () => console.log(`Server running on host ${HOST} port ${PORT} in ${process.env.NODE_ENV} mode.`)
);

// Handle unhandled promise rejections (Good Practice)
process.on('unhandledRejection', (err, promise) => {
    console.log(`Error: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});