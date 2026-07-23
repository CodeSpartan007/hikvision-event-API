import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const globalLimitMessage = {
  error: 'Too Many Requests',
  message: 'Too many requests from this IP, please try again later.',
};

const webhookLimitMessage = {
  error: 'Too Many Requests',
  message: 'Webhook rate limit exceeded. Please back off.',
};

export const rateLimitMetrics = {
  globalTriggers: 0,
  webhookTriggers: 0,
};

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
  max: env.RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: globalLimitMessage,
  handler: (req, res, _next, options) => {
    rateLimitMetrics.globalTriggers += 1;
    res.status(options.statusCode).json(globalLimitMessage);
  },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts from this IP, please try again after 15 minutes.',
  },
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: webhookLimitMessage,
  handler: (req, res, _next, options) => {
    rateLimitMetrics.webhookTriggers += 1;
    res.status(options.statusCode).json(webhookLimitMessage);
  },
});
