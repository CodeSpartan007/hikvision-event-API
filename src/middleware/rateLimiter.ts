import rateLimit from 'express-rate-limit';

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
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: globalLimitMessage,
  handler: (req, res, _next, options) => {
    rateLimitMetrics.globalTriggers += 1;
    res.status(options.statusCode).json(globalLimitMessage);
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
