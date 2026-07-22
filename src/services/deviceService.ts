import { prisma } from '../database/prisma.js';
import { broadcastDeviceUpdate } from '../websocket/broadcast.js';
import { logger } from '../utils/logger.js';

export class DeviceService {
  public async getDevices(options?: { status?: string; type?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (options?.status) where.status = options.status;
    if (options?.type) where.type = options.type;

    const limit = options?.limit ? Math.min(Math.max(options.limit, 1), 100) : undefined;
    const offset = options?.offset ? Math.max(options.offset, 0) : undefined;

    const [data, total] = await Promise.all([
      prisma.devices.findMany({
        where,
        orderBy: { lastEventAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.devices.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        limit: limit || data.length,
        offset: offset || 0,
      },
    };
  }

  public async getDeviceById(id: string) {
    return prisma.devices.findUnique({
      where: { id },
    });
  }

  public async createDevice(data: { id: string; name: string; type: string; status?: string; firmwareVersion?: string }) {
    return prisma.devices.create({
      data: {
        id: data.id,
        name: data.name,
        type: data.type,
        status: data.status || 'ONLINE',
        firmwareVersion: data.firmwareVersion || 'unknown',
      },
    });
  }

  public async updateDevice(id: string, data: { name?: string; type?: string; status?: string; firmwareVersion?: string }) {
    return prisma.devices.update({
      where: { id },
      data,
    });
  }

  public async deleteDevice(id: string) {
    return prisma.devices.delete({
      where: { id },
    });
  }

  public async checkStaleDevices(timeoutMinutes: number = 10): Promise<number> {
    try {
      const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);
      const staleDevices = await prisma.devices.findMany({
        where: {
          status: 'ONLINE',
          OR: [
            { lastEventAt: { lt: threshold } },
            { lastEventAt: null },
          ],
        },
      });

      if (staleDevices.length === 0) return 0;

      let updatedCount = 0;
      for (const device of staleDevices) {
        const updated = await prisma.devices.update({
          where: { id: device.id },
          data: { status: 'OFFLINE' },
        });
        broadcastDeviceUpdate(updated);
        updatedCount++;
      }

      logger.info({ updatedCount, timeoutMinutes }, 'Marked inactive devices as OFFLINE');
      return updatedCount;
    } catch (err) {
      logger.error(err, 'Failed to check stale devices status');
      return 0;
    }
  }
}

export const deviceService = new DeviceService();
