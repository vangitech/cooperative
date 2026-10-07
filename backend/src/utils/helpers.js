export const generateRef = (prefix = 'TXN') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const toMoney = (v) => Math.round(Number(v) * 100) / 100;

export const isPositiveNumber = (v) =>
  v !== undefined && v !== null && !isNaN(v) && Number(v) > 0;

// Wraps async route handlers so rejected promises reach Express'
// error middleware instead of hanging the request (Express 4).
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);