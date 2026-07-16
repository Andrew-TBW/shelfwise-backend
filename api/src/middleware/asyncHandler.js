// asyncHandler.js — wraps an async route handler so a rejected promise
// (e.g. a failed database query) is forwarded to Express's error handler
// instead of silently crashing the request.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
