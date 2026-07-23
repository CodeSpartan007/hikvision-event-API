import express from 'express';
import helmet from 'helmet';
import { env } from './src/config/env.js';
import healthRouter from './src/routes/health.js';
import webhookRouter from './src/routes/webhooks.js';
import devicesRouter from './src/routes/devices.js';
import eventsRouter from './src/routes/events.js';
import authRouter from './src/routes/auth.js';
import webhookSubscriptionsRouter from './src/routes/webhookSubscriptions.js';
import apiKeysRouter from './src/routes/apiKeys.js';
import auditLogsRouter from './src/routes/auditLogs.js';
import { flexibleAuthMiddleware } from './src/middleware/flexibleAuth.js';
import { globalLimiter } from './src/middleware/rateLimiter.js';
import { httpsRedirect } from './src/middleware/httpsRedirect.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import { setupSwagger } from './src/swagger.js';

const app = express();

if (env.TRUST_PROXY !== false) {
  app.set('trust proxy', env.TRUST_PROXY);
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-API-Key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(httpsRedirect);
app.use(globalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: ['*/xml', 'application/xml', 'text/xml'], limit: '10mb' }));

setupSwagger(app);

app.use(healthRouter);
app.use(webhookRouter);
app.use(authRouter);

app.use('/api', flexibleAuthMiddleware);
app.use(webhookSubscriptionsRouter);
app.use(apiKeysRouter);
app.use(devicesRouter);
app.use(eventsRouter);
app.use(auditLogsRouter);

app.use(errorHandler);

export default app;
