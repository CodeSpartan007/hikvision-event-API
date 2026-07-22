import { getIO } from './socket.js';
import { logger } from '../utils/logger.js';
import { Devices } from '@prisma/client';

export function broadcastNewEvent(event: any): void {
  try {
    const io = getIO();
    io.emit('new_event', event);

    if (event.deviceId) {
      io.to(`device:${event.deviceId}`).emit('new_event', event);
    }
    if (event.eventType) {
      io.to(`event:${event.eventType}`).emit('new_event', event);
    }

    logger.info({ eventId: event.id, eventType: event.eventType }, 'Socket.IO broadcast: new_event');
  } catch (err: any) {
    logger.warn(
      { message: err.message, eventId: event.id },
      'Could not broadcast new_event over Socket.IO'
    );
  }
}

export function broadcastDeviceUpdate(device: Devices): void {
  try {
    const io = getIO();
    io.emit('device_update', device);
    logger.info({ deviceId: device.id, status: device.status }, 'Socket.IO broadcast: device_update');
  } catch (err: any) {
    logger.warn(
      { message: err.message, deviceId: device.id },
      'Could not broadcast device_update over Socket.IO'
    );
  }
}
