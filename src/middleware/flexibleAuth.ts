import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';

export async function flexibleAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];

  if (apiKey && typeof apiKey === 'string') {
    try {
      const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const apiKeyRecord = await prisma.apiKeys.findUnique({
        where: { keyHash: hash },
      });

      if (apiKeyRecord && apiKeyRecord.isActive && (!apiKeyRecord.expiresAt || apiKeyRecord.expiresAt > new Date())) {
        req.user = { clientName: apiKeyRecord.name, apiKeyId: apiKeyRecord.id, isApiKeyClient: true };
        next();
        return;
      }
    } catch (err) {
      // Continue to try JWT if API key fails
    }
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET!);
      req.user = decoded;
      next();
      return;
    } catch (err) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
      return;
    }
  }

  res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization Bearer token or X-API-Key header' });
}
