import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService.js';

export class EventController {
  public getEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
      const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
      const eventType = req.query.eventType ? String(req.query.eventType) : undefined;
      const externalEmployeeId = req.query.externalEmployeeId ? String(req.query.externalEmployeeId) : undefined;
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;

      const result = await eventService.getEvents({
        limit,
        offset,
        cursor,
        deviceId,
        eventType,
        externalEmployeeId,
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
