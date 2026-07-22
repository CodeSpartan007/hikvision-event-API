import { prisma } from '../database/prisma.js';

export class DeviceService {
  public async getDevices() {
    return prisma.devices.findMany({
      orderBy: { lastEventAt: 'desc' },
    });
  }

  public async getDeviceById(id: string) {
    return prisma.devices.findUnique({
      where: { id },
    });
  }

  public async updateDevice(id: string, data: { name?: string; type?: string; status?: string; firmwareVersion?: string }) {
    return prisma.devices.update({
      where: { id },
      data,
    });
  }
}

export const deviceService = new DeviceService();
