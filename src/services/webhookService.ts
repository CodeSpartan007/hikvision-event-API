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
    metadata: { ip: string; headers: Record<string, any> },
    tenantId?: string
  ): void {
    this.handleWebhook('hikvision', payload, contentType, metadata, tenantId);
  }

  public handleWebhook(
    source: string,
    payload: any,
    contentType: string,
    metadata: { ip: string; headers: Record<string, any> },
    tenantId?: string
  ): void {
    setImmediate(async () => {
      try {
        logger.info(
          {
            source,
            tenantId,
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
        let isFallbackTimestamp = false;
        try {
          const parser = getParser(source);
          if (!parser) {
            throw new Error(`No parser registered for source: ${source}`);
          }
          normalizedEvent = parser(payload);
        } catch (err) {
          logger.error(err, `Failed to parse raw payload, generating fallback UNKNOWN event for ${source}`);
          isFallbackTimestamp = true;
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

        normalizedEvent.tenantId = tenantId;

        const rawHardwareTimestamp = normalizedEvent.timestamp;
        const skewResult = handleClockSkew(normalizedEvent.timestamp);
        if (skewResult.action === 'rejected') {
          logger.warn(
            {
              eventId: normalizedEvent.id,
              deviceId: normalizedEvent.deviceId,
              tenantId,
              skewSeconds: skewResult.skewSeconds,
            },
            'Event rejected due to clock skew bounds policy'
          );
          try {
            await prisma.auditLogs.create({
              data: {
                tenantId: tenantId || null,
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
          // Zero-Touch Device Auto-Provisioning & Ownership Guard
          if (normalizedEvent.deviceId !== 'unknown-device') {
            try {
              const deviceId = normalizedEvent.deviceId;
              const existingDevice = await prisma.devices.findUnique({ where: { id: deviceId } });

              if (existingDevice) {
                // Conflict Guard: Device belongs to another tenant
                if (existingDevice.tenantId && tenantId && existingDevice.tenantId !== tenantId) {
                  logger.warn(
                    { deviceId, existingTenantId: existingDevice.tenantId, requestedTenantId: tenantId },
                    'Conflict Guard: Device ownership mismatch detected. Event rejected.'
                  );
                  await prisma.auditLogs.create({
                    data: {
                      tenantId: tenantId || null,
                      action: 'UNAUTHORIZED_DEVICE_TENANT_MISMATCH',
                      actorType: 'system',
                      details: `Device ${deviceId} belongs to tenant ${existingDevice.tenantId}, but event ingestion was attempted by tenant ${tenantId}`,
                    },
                  });
                  return; // Drop event processing to prevent cross-tenant device hijacking
                }

                let updatedDevice;
                if (!existingDevice.tenantId && tenantId) {
                  // Unassigned Device: Assign to tenant
                  updatedDevice = await prisma.devices.update({
                    where: { id: deviceId },
                    data: {
                      tenantId: tenantId,
                      status: 'ONLINE',
                      lastEventAt: new Date(),
                    },
                  });
                } else {
                  updatedDevice = await prisma.devices.update({
                    where: { id: deviceId },
                    data: {
                      status: 'ONLINE',
                      lastEventAt: new Date(),
                    },
                  });
                }
                broadcastDeviceUpdate(updatedDevice);
              } else {
                // New Device: Auto-register under tenant
                const createdDevice = await prisma.devices.create({
                  data: {
                    id: deviceId,
                    tenantId: tenantId || null,
                    name: `Device ${deviceId}`,
                    type: normalizedEvent.deviceType || 'camera',
                    status: 'ONLINE',
                    firmwareVersion: 'unknown',
                    lastEventAt: new Date(),
                  },
                });
                broadcastDeviceUpdate(createdDevice);
              }
            } catch (deviceErr) {
              logger.error(
                { error: deviceErr, deviceId: normalizedEvent.deviceId },
                'Failed to update device registry status'
              );
            }
          }

          const employeeId = normalizedEvent.employeeId || null;
          const employeeName = normalizedEvent.employeeName || null;
          const externalIdentityDedupKey = normalizeExternalIdentityDedupKey(employeeId || undefined);

          let dbPayload: any = payload;
          if (Buffer.isBuffer(payload)) {
            dbPayload = { _rawBuffer: payload.toString('utf-8') };
          } else if (typeof payload !== 'object' || payload === null) {
            dbPayload = { _rawString: String(payload) };
          }

          const dedupTimestamp = isFallbackTimestamp
            ? new Date(Math.floor(normalizedEvent.timestamp.getTime() / 60000) * 60000)
            : (skewResult.action === 'normalized' ? normalizedEvent.timestamp : rawHardwareTimestamp);

          const eventDedupKey = buildEventDedupKey(
            normalizedEvent.deviceId,
            normalizedEvent.eventType,
            dedupTimestamp,
            externalIdentityDedupKey
          );

          let dbEvent;
          let shouldStore = true;

          if (normalizedEvent.eventType === 'UNKNOWN') {
            shouldStore = false;
            try {
              await prisma.auditLogs.create({
                data: {
                  tenantId: tenantId || null,
                  action: 'UNPARSEABLE_WEBHOOK_PAYLOAD',
                  actorType: 'system',
                  details: `Received unparseable or unknown event payload from ${source} (IP: ${metadata.ip})`,
                },
              });
            } catch (auditErr) {
              logger.error(auditErr, 'Failed to log unparseable payload to AuditLogs');
            }
          } else if (normalizedEvent.eventType === 'HEARTBEAT') {
            const deviceId = normalizedEvent.deviceId;

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

          if (shouldStore) {
            try {
              dbEvent = await prisma.events.create({
                data: {
                  id: normalizedEvent.id,
                  source: normalizedEvent.source,
                  tenantId: tenantId || null,
                  deviceId: normalizedEvent.deviceId,
                  eventType: normalizedEvent.eventType,
                  employeeId,
                  employeeName,
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
              { eventId: normalizedEvent.id, eventType: normalizedEvent.eventType, tenantId },
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

          logger.info(`Processing of ${source} webhook completed successfully`);
        } catch (err) {
          logger.error(err, 'Error occurred during background database event persistence');
        }
      } catch (fatalErr) {
        logger.error(fatalErr, 'Unhandled fatal error in background setImmediate webhook pipeline');
      }
    });
  }

  public async pruneHeartbeatCounters(): Promise<void> {
    try {
      const expiryThreshold = new Date(Date.now() - 5 * 60 * 1000);
      const result = await prisma.heartbeatCounters.deleteMany({
        where: {
          updatedAt: { lt: expiryThreshold },
        },
      });
      if (result.count > 0) {
        logger.info({ prunedCount: result.count }, 'Pruned stale heartbeat counters');
      }
    } catch (pruneErr) {
      logger.error(pruneErr, 'Failed to prune stale heartbeat counters');
    }
  }
}

export const webhookService = new WebhookService();
