import { logger } from '../utils/logger.js';
import { getParser } from '../parsers/registry.js';
import { prisma } from '../database/prisma.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NormalizedEvent } from '../models/normalizedEvent.js';
import { broadcastNewEvent, broadcastDeviceUpdate } from '../websocket/broadcast.js';
import { handleClockSkew } from '../utils/timeHandler.js';
import { webhookDispatcher } from './webhookDispatcher.js';

function normalizeExternalIdentityDedupKey(externalPersonId: string | undefined): string {
  if (!externalPersonId) {
    return '__NO_EXTERNAL_ID__';
  }
  const normalized = externalPersonId.trim();
  return normalized.length > 0 ? normalized : '__NO_EXTERNAL_ID__';
}

function buildEventDedupKey(
  deviceId: string,
  eventType: string,
  timestamp: Date,
  externalIdentityDedupKey: string
): string {
  return `${deviceId}|${eventType}|${timestamp.toISOString()}|${externalIdentityDedupKey}`;
}

export class WebhookService {
  public handleHikvisionWebhook(
    payload: any,
    contentType: string,
    metadata: { ip: string; headers: Record<string, any> }
  ): void {
    this.handleWebhook('hikvision', payload, contentType, metadata);
  }

  public handleWebhook(
    source: string,
    payload: any,
    contentType: string,
    metadata: { ip: string; headers: Record<string, any> }
  ): void {
    setImmediate(async () => {
      logger.info(
        {
          source,
          contentType,
          clientIp: metadata.ip,
          payloadSummary: {
            type: typeof payload,
            isBuffer: Buffer.isBuffer(payload),
            keys: typeof payload === 'object' && payload !== null ? Object.keys(payload) : undefined,
          },
        },
        `Asynchronously processing ${source} webhook payload`
      );

      logger.debug({ rawPayload: payload }, 'Background webhook raw payload received');

      let normalizedEvent: NormalizedEvent;
      try {
        const parser = getParser(source);
        if (!parser) {
          throw new Error(`No parser registered for source: ${source}`);
        }
        normalizedEvent = parser(payload);
      } catch (err) {
        logger.error(err, `Failed to parse raw payload, generating fallback UNKNOWN event for ${source}`);
        normalizedEvent = {
          id: randomUUID(),
          source: source,
          deviceId: 'unknown-device',
          deviceType: 'camera' as const,
          eventType: 'UNKNOWN' as const,
          timestamp: new Date(),
          rawPayload: payload,
        };
      }
      
      const skewResult = handleClockSkew(normalizedEvent.timestamp);
      if (skewResult.action === 'rejected') {
        logger.warn(
          {
            eventId: normalizedEvent.id,
            deviceId: normalizedEvent.deviceId,
            skewSeconds: skewResult.skewSeconds,
          },
          'Event rejected due to clock skew bounds policy'
        );
        try {
          await prisma.auditLogs.create({
            data: {
              action: 'REJECT_EVENT_SKEW',
              actorType: 'system',
              details: `Rejected event ${normalizedEvent.id} from device ${normalizedEvent.deviceId} due to clock skew (${skewResult.skewSeconds}s)`,
            },
          });
        } catch (auditErr) {
          logger.error(auditErr, 'Failed to log rejected event to AuditLogs');
        }
        return;
      } else if (skewResult.action === 'normalized') {
        logger.info(
          {
            eventId: normalizedEvent.id,
            deviceId: normalizedEvent.deviceId,
            originalTimestamp: normalizedEvent.timestamp,
            normalizedTimestamp: skewResult.timestamp,
            skewSeconds: skewResult.skewSeconds,
          },
          'Event timestamp normalized to server time due to clock skew policy'
        );
        normalizedEvent.timestamp = skewResult.timestamp;
      }

      try {
        if (!normalizedEvent.externalEmployeeId && normalizedEvent.employeeId) {
          normalizedEvent.externalEmployeeId = normalizedEvent.employeeId;
        }

        const externalPersonId = normalizedEvent.externalEmployeeId || normalizedEvent.employeeId;
        const externalIdentityDedupKey = normalizeExternalIdentityDedupKey(externalPersonId);

        let dbPayload: any = payload;
        if (Buffer.isBuffer(payload)) {
          dbPayload = { _rawBuffer: payload.toString('utf-8') };
        } else if (typeof payload !== 'object' || payload === null) {
          dbPayload = { _rawString: String(payload) };
        }

        const eventDedupKey = buildEventDedupKey(
          normalizedEvent.deviceId,
          normalizedEvent.eventType,
          normalizedEvent.timestamp,
          externalIdentityDedupKey
        );

        let dbEvent;
        let shouldStore = true;

        if (normalizedEvent.eventType === 'UNKNOWN') {
          shouldStore = false;
        } else if (normalizedEvent.eventType === 'HEARTBEAT') {
          const deviceId = normalizedEvent.deviceId;
          const expiryThreshold = new Date(Date.now() - 5 * 60 * 1000);
          try {
            await prisma.heartbeatCounters.deleteMany({
              where: {
                updatedAt: { lt: expiryThreshold },
              },
            });
          } catch (pruneErr) {
            logger.error(pruneErr, 'Failed to prune stale heartbeat counters');
          }

          const updatedCounter = await prisma.heartbeatCounters.upsert({
            where: { deviceId },
            update: {
              count: { increment: 1 },
            },
            create: {
              deviceId,
              count: 1,
            },
          });

          if (updatedCounter.count % 10 !== 0) {
            shouldStore = false;
          }
        }

        const externalEmployeeId = normalizedEvent.externalEmployeeId || null;

        if (shouldStore) {
          try {
            dbEvent = await prisma.events.create({
              data: {
                id: normalizedEvent.id,
                source: normalizedEvent.source,
                deviceId: normalizedEvent.deviceId,
                eventType: normalizedEvent.eventType,
                externalEmployeeId,
                eventDedupKey,
                rawPayload: dbPayload,
                auditMetadata: {
                  clientIp: metadata.ip,
                  contentType: contentType,
                  headers: metadata.headers,
                },
                timestamp: normalizedEvent.timestamp,
              },
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              logger.info(
                { eventId: normalizedEvent.id, eventDedupKey },
                'Discarding duplicate event (deduplication conflict)'
              );
              return;
            }
            throw error;
          }

          logger.info(
            { eventId: normalizedEvent.id, eventType: normalizedEvent.eventType },
            'Successfully persisted event to database'
          );

          broadcastNewEvent(dbEvent);

          // Dispatch event to registered external webhook subscribers asynchronously
          webhookDispatcher.dispatchEvent(normalizedEvent).catch((err) => {
            logger.error(err, 'Failed executing external webhook subscriber dispatch pipeline');
          });
        } else {
          logger.debug(
            { eventId: normalizedEvent.id, deviceId: normalizedEvent.deviceId },
            'Skipping heartbeat persistence and broadcast (throttled)'
          );
        }

        try {
          const deviceId = normalizedEvent.deviceId;
          const existingDevice = await prisma.devices.findUnique({
            where: { id: deviceId },
          });

          if (existingDevice) {
            const updatedData: any = {
              lastEventAt: new Date(),
            };
            if (existingDevice.status === 'OFFLINE') {
              updatedData.status = 'ONLINE';
            }
            const updatedDevice = await prisma.devices.update({
              where: { id: deviceId },
              data: updatedData,
            });
            broadcastDeviceUpdate(updatedDevice);
          } else {
            const newDevice = await prisma.devices.create({
              data: {
                id: deviceId,
                name: `Device ${deviceId}`,
                type: normalizedEvent.deviceType || 'camera',
                status: 'ONLINE',
                firmwareVersion: 'unknown',
                lastEventAt: new Date(),
              },
            });
            broadcastDeviceUpdate(newDevice);
          }
        } catch (deviceErr) {
          logger.error(
            { error: deviceErr, deviceId: normalizedEvent.deviceId },
            'Failed to update device registry status'
          );
        }

        logger.info(`Processing of ${source} webhook completed successfully`);
      } catch (err) {
        logger.error(err, 'Error occurred during background database event persistence');
      }
    });
  }
}

export const webhookService = new WebhookService();
