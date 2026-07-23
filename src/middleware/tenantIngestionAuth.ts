import { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/prisma.js';
import { Tenants } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenants;
    }
  }
}

export async function tenantIngestionAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantKey = (req.query.tenantKey as string) || (req.headers['x-tenant-key'] as string);

    if (!tenantKey || typeof tenantKey !== 'string') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing required tenantKey query parameter or X-Tenant-Key header',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const tenant = await prisma.tenants.findUnique({
      where: { tenantKey: tenantKey.trim() },
    });

    if (!tenant) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid tenantKey provided',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
}
