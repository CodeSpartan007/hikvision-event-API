import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { deviceService } from '../services/deviceService.js';

const createDeviceSchema = z.object({
  id: z.string().min(1, 'Device ID is required'),
  name: z.string().min(1, 'Device name is required'),
  type: z.enum(['camera', 'face_terminal', 'door_controller']),
  status: z.enum(['ONLINE', 'OFFLINE']).optional(),
  firmwareVersion: z.string().optional(),
});

const updateDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['camera', 'face_terminal', 'door_controller']).optional(),
  status: z.enum(['ONLINE', 'OFFLINE']).optional(),
  firmwareVersion: z.string().optional(),
});

export class DeviceController {
  public getDevices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.role === 'SUPER_ADMIN' ? undefined : req.user?.tenantId;
      const status = req.query.status ? String(req.query.status) : undefined;
      const type = req.query.type ? String(req.query.type) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;

      const devices = await deviceService.getDevices({ tenantId, status, type, limit, offset });
      res.status(200).json(devices);
    } catch (err) {
      next(err);
    }
  };

  public getDeviceById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.role === 'SUPER_ADMIN' ? undefined : req.user?.tenantId;
      const id = req.params.id as string;
      const device = await deviceService.getDeviceById(id, tenantId);

      if (!device) {
        res.status(404).json({ error: 'Not Found', message: `Device with ID ${id} not found` });
        return;
      }

      res.status(200).json(device);
    } catch (err) {
      next(err);
    }
  };

  public createDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.role === 'SUPER_ADMIN' ? undefined : req.user?.tenantId;
      const deviceData = createDeviceSchema.parse(req.body);

      const existing = await deviceService.getDeviceById(deviceData.id);
      if (existing) {
        res.status(409).json({ error: 'Conflict', message: `Device with ID ${deviceData.id} already exists` });
        return;
      }

      const device = await deviceService.createDevice({ ...deviceData, tenantId });
      res.status(201).json(device);
    } catch (err) {
      next(err);
    }
  };

  public updateDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.role === 'SUPER_ADMIN' ? undefined : req.user?.tenantId;
      const id = req.params.id as string;
      const updateData = updateDeviceSchema.parse(req.body);

      const existing = await deviceService.getDeviceById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: `Device with ID ${id} not found` });
        return;
      }

      const device = await deviceService.updateDevice(id, updateData);
      res.status(200).json(device);
    } catch (err) {
      next(err);
    }
  };

  public deleteDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.role === 'SUPER_ADMIN' ? undefined : req.user?.tenantId;
      const id = req.params.id as string;

      const existing = await deviceService.getDeviceById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: `Device with ID ${id} not found` });
        return;
      }

      await deviceService.deleteDevice(id);
      res.status(200).json({ message: `Device ${id} deleted successfully` });
    } catch (err) {
      next(err);
    }
  };
}

export const deviceController = new DeviceController();
