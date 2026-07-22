import { Request, Response, NextFunction } from 'express';
import { deviceService } from '../services/deviceService.js';

export class DeviceController {
  public getDevices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const devices = await deviceService.getDevices();
      res.status(200).json(devices);
    } catch (err) {
      next(err);
    }
  };

  public getDeviceById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const device = await deviceService.getDeviceById(id);

      if (!device) {
        res.status(404).json({ error: 'Not Found', message: `Device with ID ${id} not found` });
        return;
      }

      res.status(200).json(device);
    } catch (err) {
      next(err);
    }
  };

  public updateDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { name, type, status, firmwareVersion } = req.body;

      const device = await deviceService.updateDevice(id, { name, type, status, firmwareVersion });
      res.status(200).json(device);
    } catch (err) {
      next(err);
    }
  };
}

export const deviceController = new DeviceController();
