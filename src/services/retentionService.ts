import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';

export class RetentionService {
  public async pruneRawPayloads(): Promise<number | null> {
    const retentionDays = env.RAW_PAYLOAD_RETENTION_DAYS;

    if (retentionDays === undefined) {
      logger.debug('Event rawPayload retention pruning is disabled (RAW_PAYLOAD_RETENTION_DAYS is not set)');
      return null;
    }

    logger.info(
      { retentionDays },
      'Starting event rawPayload retention pruning job'
    );

    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const result = await prisma.events.updateMany({
        where: {
          timestamp: {
            lt: cutoffDate,
          },
          rawPayload: {
            not: Prisma.DbNull,
          },
        },
        data: {
          rawPayload: Prisma.DbNull,
        },
      });

      logger.info(
        {
          prunedCount: result.count,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
        },
        'Event rawPayload retention pruning job completed successfully'
      );

      return result.count;
    } catch (error) {
      logger.error(error, 'Error occurred during event rawPayload retention pruning');
      throw error;
    }
  }

  public async pruneFailedWebhookDeliveries(olderThanDays: number = 7): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const result = await prisma.pendingWebhookDeliveries.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          attempts: { gte: 5 },
        },
      });

      if (result.count > 0) {
        logger.info({ prunedDeliveriesCount: result.count }, 'Pruned stale exhausted webhook delivery queue records');
      }
      return result.count;
    } catch (error) {
      logger.error(error, 'Error occurred during pending webhook delivery pruning');
      return 0;
    }
  }
}

export const retentionService = new RetentionService();
