// index.js

// 1. Load Environment Variables (MUST be first)
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet'); // Security headers
const cors = require('cors');     // Cross-Origin Resource Sharing
const cookieParser = require('cookie-parser'); // To read JWT from cookies
const hpp = require('hpp'); // HTTP Parameter Pollution protection

// Route files
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

// Error Handler Middleware
const errorHandler = require('./middleware/error'); 

const app = express();
const PORT = process.env.PORT || 5000;

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
    PORT,
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode.`)
);

// Handle unhandled promise rejections (Good Practice)
process.on('unhandledRejection', (err, promise) => {
    console.log(`Error: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});
// const express = require('express');

// const mongoose = require('mongoose');

// const dotenv = require('dotenv');

// const cookieParser = require('cookie-parser');

// const helmet = require('helmet');

// const authRoutes = require('./routes/authRoutes');

// const taskRoutes = require('./routes/taskRoutes');

// const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// dotenv.config();


// const app = express();

// app.use(helmet());

// app.use(express.json());

// app.use(cookieParser());


// mongoose.connect(process.env.MONGO_URI)

//   .then(() => console.log('MongoDB connected!'))

//   .catch(err => console.error('MongoDB connection error:', err));


// app.use('/api/auth', authRoutes);

// app.use('/api/tasks', taskRoutes);


// app.get('/', (req, res) => {

//   res.send('MERN Task Manager API is running!');

// });


// app.use(notFound);

// app.use(errorHandler);


// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {

//   console.log(`Server running on port ${PORT}`);

// });