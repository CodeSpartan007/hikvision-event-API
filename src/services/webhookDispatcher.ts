import crypto from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { logger } from '../utils/logger.js';
import { NormalizedEvent } from '../models/normalizedEvent.js';
import { validateSafeWebhookUrl } from '../utils/urlValidator.js';
import { formatLocalISO } from '../utils/timeHandler.js';

export class WebhookDispatcher {
  private isProcessing = false;
  private hasPendingWakeup = false;

  public async dispatchEvent(event: NormalizedEvent): Promise<void> {
    try {
      const subscriptions = await prisma.webhookSubscriptions.findMany({
        where: {
          isActive: true,
          OR: [
            { eventTypes: { has: event.eventType } },
            { eventTypes: { has: '*' } },
          ],
        },
      });

      if (subscriptions.length === 0) {
        return;
      }

      logger.info(
        { eventId: event.id, matchedSubscribers: subscriptions.length },
        'Persisting durable webhook deliveries for subscribers'
      );

      const payloadObj = {
        timestamp: new Date().toISOString(),
        event: {
          id: event.id,
          source: event.source,
          deviceId: event.deviceId,
          deviceType: event.deviceType,
          eventType: event.eventType,
          employeeId: event.employeeId,
          externalEmployeeId: event.externalEmployeeId,
          timestamp: event.timestamp,
          localTimestamp: formatLocalISO(new Date(event.timestamp)),
        },
      };

      for (const subscription of subscriptions) {
        await prisma.pendingWebhookDeliveries.create({
          data: {
            url: subscription.url,
            secret: subscription.secret,
            payload: payloadObj,
            attempts: 0,
            maxAttempts: 5,
            nextAttemptAt: new Date(Date.now() - 1000),
          },
        });
      }

      this.processPendingDeliveries().catch((error) => {
        logger.error(error, 'Unhandled error in asynchronous webhook delivery processing');
      });
    } catch (error) {
      logger.error(error, 'Error creating durable webhook delivery records in database');
    }
  }

  public async processPendingDeliveries(): Promise<void> {
    if (this.isProcessing) {
      this.hasPendingWakeup = true;
      return;
    }
    this.isProcessing = true;

    try {
      const processedIds = new Set<string>();
      do {
        this.hasPendingWakeup = false;

        let pendingDeliveries = await prisma.pendingWebhookDeliveries.findMany({
          where: {
            nextAttemptAt: { lte: new Date() },
            id: { notIn: Array.from(processedIds) },
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });

        while (pendingDeliveries.length > 0) {
          for (const delivery of pendingDeliveries) {
            processedIds.add(delivery.id);
          }

          // Concurrent batch delivery
          await Promise.allSettled(
            pendingDeliveries.map((delivery) => this.deliverSingleWebhook(delivery))
          );

          pendingDeliveries = await prisma.pendingWebhookDeliveries.findMany({
            where: {
              nextAttemptAt: { lte: new Date() },
              id: { notIn: Array.from(processedIds) },
            },
            orderBy: { createdAt: 'asc' },
            take: 20,
          });
        }
      } while (this.hasPendingWakeup);
    } catch (error) {
      logger.error(error, 'Error querying pending webhook deliveries from database');
    } finally {
      this.isProcessing = false;
      this.hasPendingWakeup = false;
    }
  }

  private async deliverSingleWebhook(delivery: {
    id: string;
    url: string;
    secret: string;
    payload: any;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    const payloadStr = typeof delivery.payload === 'string'
      ? delivery.payload
      : JSON.stringify(delivery.payload);

    const timestampHeader = new Date().toISOString();
    const signaturePayload = `${timestampHeader}.${payloadStr}`;
    const signature = crypto.createHmac('sha256', delivery.secret).update(signaturePayload).digest('hex');
    const currentAttempt = delivery.attempts + 1;

    const urlValidation = await validateSafeWebhookUrl(delivery.url);
    if (!urlValidation.valid) {
      logger.error(
        { url: delivery.url, deliveryId: delivery.id, reason: urlValidation.reason },
        'Aborting webhook dispatch: destination URL failed dispatch-time safety validation'
      );
      await prisma.pendingWebhookDeliveries.delete({ where: { id: delivery.id } });
      return;
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 8000);

    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HikvisionEventReceiver-Webhook-Dispatcher/1.0',
          'X-Hub-Signature-256': `sha256=${signature}`,
          'X-Hub-Timestamp': timestampHeader,
        },
        body: payloadStr,
        signal: timeoutController.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        await prisma.pendingWebhookDeliveries.delete({ where: { id: delivery.id } });
        logger.info({ url: delivery.url, deliveryId: delivery.id }, 'Webhook successfully delivered and removed from pending queue');
        return;
      }

      throw new Error(`Webhook target responded with non-2xx status: ${response.status}`);
    } catch (error: any) {
      clearTimeout(timeoutId);

      logger.warn(
        { url: delivery.url, attempt: currentAttempt, maxAttempts: delivery.maxAttempts, error: error.message || error },
        `Durable webhook delivery failed on attempt ${currentAttempt}/${delivery.maxAttempts}`
      );

      if (currentAttempt >= delivery.maxAttempts) {
        await prisma.pendingWebhookDeliveries.delete({ where: { id: delivery.id } });
        logger.error(
          { url: delivery.url, deliveryId: delivery.id },
          `Webhook delivery exhausted all ${delivery.maxAttempts} attempts. Removed from database queue.`
        );
      } else {
        const delayMs = Math.pow(2, currentAttempt) * 1000;
        const nextAttemptAt = new Date(Date.now() + delayMs);

        await prisma.pendingWebhookDeliveries.update({
          where: { id: delivery.id },
          data: {
            attempts: currentAttempt,
            nextAttemptAt: nextAttemptAt,
          },
        });
      }
    }
  }
}

export const webhookDispatcher = new WebhookDispatcher();
