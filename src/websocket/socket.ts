import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../database/prisma.js';

let io: SocketIOServer | null = null;

export function initSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    let apiKey: string | undefined;

    if (socket.handshake.auth && typeof socket.handshake.auth.apiKey === 'string') {
      apiKey = socket.handshake.auth.apiKey;
    } else if (socket.handshake.headers && (typeof socket.handshake.headers['x-api-key'] === 'string' || typeof socket.handshake.headers['X-API-Key'] === 'string')) {
      apiKey = (socket.handshake.headers['x-api-key'] || socket.handshake.headers['X-API-Key']) as string;
    } else if (socket.handshake.query && typeof socket.handshake.query.apiKey === 'string') {
      apiKey = socket.handshake.query.apiKey as string;
    }

    if (apiKey) {
      try {
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const apiKeyRecord = await prisma.apiKeys.findUnique({ where: { keyHash: hash } });
        if (apiKeyRecord && apiKeyRecord.isActive && (!apiKeyRecord.expiresAt || apiKeyRecord.expiresAt > new Date())) {
          (socket as any).user = {
            clientName: apiKeyRecord.name,
            apiKeyId: apiKeyRecord.id,
            tenantId: apiKeyRecord.tenantId,
            isApiKeyClient: true,
          };
          return next();
        }
      } catch (err) {
        // Fall back to JWT validation
      }
    }

    let token: string | undefined;

    if (socket.handshake.auth) {
      if (typeof socket.handshake.auth.token === 'string') {
        token = socket.handshake.auth.token;
      } else if (typeof socket.handshake.auth.Authorization === 'string') {
        token = socket.handshake.auth.Authorization;
      }
    }

    if (!token && socket.handshake.headers && typeof socket.handshake.headers.authorization === 'string') {
      token = socket.handshake.headers.authorization;
    }

    if (!token && socket.handshake.query && typeof socket.handshake.query.token === 'string') {
      token = socket.handshake.query.token;
    }

    if (!token) {
      logger.warn({ socketId: socket.id }, 'Socket.IO connection rejected: missing token or API key');
      return next(new Error('Unauthorized: Missing token or API key'));
    }

    if (token.startsWith('Bearer ')) {
      token = token.slice(7);
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET!);
      (socket as any).user = decoded;
      next();
    } catch (err: any) {
      logger.warn({ socketId: socket.id, error: err.name }, 'Socket.IO connection rejected: invalid or expired token');
      return next(new Error('Unauthorized: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    logger.info({ socketId: socket.id, tenantId: user?.tenantId }, 'Socket.IO client connected');

    if (user?.tenantId) {
      socket.join(`tenant:${user.tenantId}`);
      logger.info({ socketId: socket.id, tenantId: user.tenantId }, 'Socket client automatically joined tenant room');
    }

    socket.on('subscribe', (room: unknown) => {
      if (typeof room === 'string' && room.trim()) {
        const targetRoom = room.trim();

        if (user?.role === 'SUPER_ADMIN') {
          socket.join(targetRoom);
          logger.info({ socketId: socket.id, room: targetRoom }, 'Super Admin subscribed to room');
          return;
        }

        if (targetRoom.startsWith('tenant:')) {
          const parts = targetRoom.split(':');
          const roomTenantId = parts[1];
          if (user?.tenantId && user.tenantId === roomTenantId) {
            socket.join(targetRoom);
            logger.info({ socketId: socket.id, room: targetRoom, tenantId: user.tenantId }, 'Socket client subscribed to tenant room');
          } else {
            logger.warn({ socketId: socket.id, room: targetRoom, userTenantId: user?.tenantId }, 'Unauthorized tenant room subscription attempt rejected');
            socket.emit('error', { message: 'Unauthorized: Cannot subscribe to foreign tenant room' });
          }
        } else {
          if (user?.tenantId) {
            logger.warn({ socketId: socket.id, room: targetRoom, userTenantId: user?.tenantId }, 'Non-super-admin attempted to subscribe to unscoped room');
            socket.emit('error', { message: 'Unauthorized: Non-scoped room subscription not allowed' });
          } else {
            socket.join(targetRoom);
            logger.info({ socketId: socket.id, room: targetRoom }, 'Socket client subscribed to room');
          }
        }
      }
    });

  socket.on('unsubscribe', (room: unknown) => {
      if (typeof room === 'string' && room.trim()) {
        socket.leave(room.trim());
        logger.info({ socketId: socket.id, room: room.trim() }, 'Socket client unsubscribed from room');
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Socket.IO client disconnected');
    });

    socket.on('error', (err) => {
      logger.error({ socketId: socket.id, err }, 'Socket.IO client connection error');
    });
  });

  logger.info('Socket.IO server initialized successfully');
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO has not been initialized. Please call initSocketServer first.');
  }
  return io;
}
