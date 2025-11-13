// middleware/error.js (Converted to ESM)

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log to console for dev
  // NOTE: Ensure you have the 'colors' package installed/imported if you use '.red'
  console.log(err.stack); // Removed .red for safety if 'colors' isn't available/imported

  // Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    error = { statusCode: 404, message };
  }

  // Mongoose Duplicate Key (E11000)
  if (err.code === 11000) {
    // Extract the key causing the duplication (e.g., 'email' or 'username')
    const field = Object.keys(err.keyValue); 
    const message = `This User already exist. Go to login: ${field.join(', ')}.`;
    error = { statusCode: 400, message };
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    // Extract error messages from all failed fields
    const message = Object.values(err.errors).map(val => val.message);
    error = { statusCode: 400, message: message.join(', ') };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
  });
};

// Use ESM default export
export default errorHandler;