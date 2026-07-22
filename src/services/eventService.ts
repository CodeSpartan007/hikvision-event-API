import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/errors.js';

export interface EventQueryOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
  deviceId?: string;
  eventType?: string;
  employeeId?: string;
  startDate?: Date;
  endDate?: Date;
}

export class EventService {
  public async getEvents(options: EventQueryOptions = {}) {
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    const where: any = {};

    if (options.deviceId) {
      where.deviceId = options.deviceId;
    }
    if (options.eventType) {
      where.eventType = options.eventType;
    }
    if (options.employeeId) {
      where.employeeId = options.employeeId;
    }
    if (options.startDate || options.endDate) {
      where.timestamp = {};
      if (options.startDate) where.timestamp.gte = options.startDate;
      if (options.endDate) where.timestamp.lte = options.endDate;
    }

    const total = await prisma.events.count({ where });

    let findManyOptions: any = {
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    };

    if (options.cursor) {
      const existingCursor = await prisma.events.findUnique({
        where: { id: options.cursor },
        select: { id: true },
      });
      if (!existingCursor) {
        throw new AppError(`Invalid cursor '${options.cursor}' provided for pagination`, 400);
      }
      findManyOptions.cursor = { id: options.cursor };
      findManyOptions.skip = 1;
    } else if (offset > 0) {
      findManyOptions.skip = offset;
    }

    const items = await prisma.events.findMany(findManyOptions);

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

    return {
      data,
      pagination: {
        total,
        limit,
        offset: options.cursor ? undefined : offset,
        hasMore,
        nextCursor,
      },
    };
  }

  public async getEventById(id: string) {
    return prisma.events.findUnique({
      where: { id },
    });
  }
}

export const eventService = new EventService();
