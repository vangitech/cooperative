import { rateLimit } from 'express-rate-limit';

const tooMany = (message) => ({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message },
});

// General auth endpoints: login / register.
export const authLimiter = rateLimit(tooMany('Too many attempts, try again in 15 minutes'));

// Password-reset requests: strict, this endpoint also sends email.
export const forgotLimiter = rateLimit({
  ...tooMany('Too many reset requests, try again later'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
});
