const isProd = process.env.NODE_ENV === "production";

const USER_MESSAGES = {
  default: "Something went wrong. Please try again.",
  server: "We are unable to process your request right now. Please try again shortly.",
  badRequest: "Your request could not be completed. Please check your input and try again.",
  unauthorized: "You need to log in to continue.",
  forbidden: "You do not have permission to perform this action.",
  notFound: "The requested resource was not found.",
};

const getProdMessage = (statusCode = 500) => {
  if (statusCode === 400 || statusCode === 422) return USER_MESSAGES.badRequest;
  if (statusCode === 401) return USER_MESSAGES.unauthorized;
  if (statusCode === 403) return USER_MESSAGES.forbidden;
  if (statusCode === 404) return USER_MESSAGES.notFound;
  if (statusCode >= 500) return USER_MESSAGES.server;
  return USER_MESSAGES.default;
};

const errorHandler = (err, req, res, next) => {
  let statusCode = Number(err?.statusCode || err?.status || 500);
  let message = String(err?.message || "Server Error");

  if (err?.name === "CastError") {
    statusCode = 404;
    message = "Resource not found.";
  }

  if (err?.code === 11000) {
    statusCode = 400;
    message = "An account with these details already exists. Please log in instead.";
  }

  if (err?.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors || {})
      .map((val) => val.message)
      .join(", ");
  }

  if (!isProd) {
    console.error("[ERROR]", {
      method: req.method,
      url: req.originalUrl,
      statusCode,
      message,
      stack: err?.stack,
    });
  }

  const responseBody = {
    success: false,
    message: isProd ? getProdMessage(statusCode) : message,
  };

  if (!isProd) {
    responseBody.error = message;
    responseBody.details = err?.details || null;
    responseBody.stack = err?.stack || null;
  }

  return res.status(statusCode).json(responseBody);
};

export default errorHandler;
