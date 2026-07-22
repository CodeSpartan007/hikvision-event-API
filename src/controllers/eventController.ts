import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService.js';

const VALID_EVENT_TYPES = new Set([
  'CHECK_IN',
  'CHECK_OUT',
  'DOOR_OPEN',
  'DOOR_CLOSED',
  'DOOR_FORCED',
  'MOTION',
  'CAMERA_OFFLINE',
  'HEARTBEAT',
  'UNKNOWN',
]);

export class EventController {
  public getEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let limit: number | undefined = undefined;
      if (req.query.limit !== undefined) {
        const parsed = Number(req.query.limit);
        if (isNaN(parsed) || parsed < 1) {
          res.status(400).json({ error: 'Bad Request', message: 'limit must be a positive number' });
          return;
        }
        limit = parsed;
      }

      let offset: number | undefined = undefined;
      if (req.query.offset !== undefined) {
        const parsed = Number(req.query.offset);
        if (isNaN(parsed) || parsed < 0) {
          res.status(400).json({ error: 'Bad Request', message: 'offset must be a non-negative number' });
          return;
        }
        offset = parsed;
      }

      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
      const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;

      let eventType: string | undefined = undefined;
      if (req.query.eventType !== undefined) {
        const typeStr = String(req.query.eventType).toUpperCase();
        if (!VALID_EVENT_TYPES.has(typeStr)) {
          res.status(400).json({
            error: 'Bad Request',
            message: `Invalid eventType '${req.query.eventType}'. Valid event types are: ${Array.from(VALID_EVENT_TYPES).join(', ')}`,
          });
          return;
        }
        eventType = typeStr;
      }

      const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;
      const employeeName = req.query.employeeName ? String(req.query.employeeName) : undefined;
      let startDate: Date | undefined = undefined;
      if (req.query.startDate) {
        const parsed = new Date(String(req.query.startDate));
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Bad Request', message: 'Invalid startDate date format provided' });
          return;
        }
        startDate = parsed;
      }

      let endDate: Date | undefined = undefined;
      if (req.query.endDate) {
        const parsed = new Date(String(req.query.endDate));
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Bad Request', message: 'Invalid endDate date format provided' });
          return;
        }
        endDate = parsed;
      }

      const result = await eventService.getEvents({
        limit,
        offset,
        cursor,
        deviceId,
        eventType,
        employeeId,
        employeeName,
        startDate,
        endDate,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public getEventById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const event = await eventService.getEventById(id);

      if (!event) {
        res.status(404).json({ error: 'Not Found', message: `Event with ID ${id} not found` });
        return;
      }

      res.status(200).json(event);
    } catch (err) {
      next(err);
    }
  };
}

export const eventController = new EventController();
