import { env } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import app from './app.js';
import { prisma, pool } from './src/database/prisma.js';
import { initSocketServer } from './src/websocket/socket.js';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, env: env.NODE_ENV },
    'Hikvision Event Receiver server started and listening'
  );
});

initSocketServer(server);

// Start background durable webhook dispatcher retry worker
let webhookDispatcherInterval: NodeJS.Timeout | null = null;
const WEBHOOK_DISPATCH_CHECK_INTERVAL_MS = 60 * 1000;

(async () => {
  try {
    const { webhookDispatcher } = await import('./src/services/webhookDispatcher.js');
    await webhookDispatcher.processPendingDeliveries();
  } catch (error) {
    logger.error(error, 'Initial durable webhook delivery resume error on startup');
  }
})();

webhookDispatcherInterval = setInterval(async () => {
  try {
    const { webhookDispatcher } = await import('./src/services/webhookDispatcher.js');
    await webhookDispatcher.processPendingDeliveries();
  } catch (error) {
    logger.error(error, 'Durable webhook delivery interval worker error');
  }
}, WEBHOOK_DISPATCH_CHECK_INTERVAL_MS);

webhookDispatcherInterval.unref();

// Periodic Heartbeat Counter Pruning & Device Health Checkers
let heartbeatPruneInterval: NodeJS.Timeout | null = null;
let deviceHealthInterval: NodeJS.Timeout | null = null;

const HEARTBEAT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DEVICE_HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000;

heartbeatPruneInterval = setInterval(async () => {
  try {
    const { webhookService } = await import('./src/services/webhookService.js');
    await webhookService.pruneHeartbeatCounters();
  } catch (error) {
    logger.error(error, 'Heartbeat counter pruning worker error');
  }
}, HEARTBEAT_PRUNE_INTERVAL_MS);
heartbeatPruneInterval.unref();

deviceHealthInterval = setInterval(async () => {
  try {
    const { deviceService } = await import('./src/services/deviceService.js');
    await deviceService.checkStaleDevices(10);
  } catch (error) {
    logger.error(error, 'Device health check worker error');
  }
}, DEVICE_HEALTH_CHECK_INTERVAL_MS);
deviceHealthInterval.unref();

let retentionInterval: NodeJS.Timeout | null = null;

if (env.RAW_PAYLOAD_RETENTION_DAYS !== undefined) {
  const RETENTION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  (async () => {
    try {
      const { retentionService } = await import('./src/services/retentionService.js');
      await retentionService.pruneRawPayloads();
    } catch (error) {
      logger.error(error, 'Initial event retention pruning job error on startup');
    }
  })();

  retentionInterval = setInterval(async () => {
    try {
      const { retentionService } = await import('./src/services/retentionService.js');
      await retentionService.pruneRawPayloads();
    } catch (error) {
      logger.error(error, 'Event retention pruning job interval error');
    }
  }, RETENTION_CHECK_INTERVAL_MS);

  retentionInterval.unref();
}

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, 'Graceful shutdown signal received');

  if (webhookDispatcherInterval) {
    clearInterval(webhookDispatcherInterval);
    logger.info('Background webhook dispatcher interval cleared');
  }

  if (heartbeatPruneInterval) {
    clearInterval(heartbeatPruneInterval);
    logger.info('Background heartbeat prune interval cleared');
  }

  if (deviceHealthInterval) {
    clearInterval(deviceHealthInterval);
    logger.info('Background device health interval cleared');
  }

  if (retentionInterval) {
    clearInterval(retentionInterval);
    logger.info('Background retention pruning interval cleared');
  }

  const forceExitTimeout = setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);

  forceExitTimeout.unref();

  server.close(async (err) => {
    if (err) {
      logger.error(err, 'Error occurred while closing HTTP server');
    } else {
      logger.info('HTTP server closed successfully');
    }

    try {
      await prisma.$disconnect();
      await pool.end();
      logger.info('Database connection pool disconnected');
    } catch (dbErr) {
      logger.error(dbErr, 'Error occurred while disconnecting database client');
    }

    logger.info('Shutdown complete');
    clearTimeout(forceExitTimeout);
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
