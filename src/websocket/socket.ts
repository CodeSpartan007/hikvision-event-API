import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let io: SocketIOServer | null = null;

export function initSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
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
      logger.warn({ socketId: socket.id }, 'Socket.IO connection rejected: missing token');
      return next(new Error('Unauthorized: Missing token'));
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
    logger.info({ socketId: socket.id }, 'Socket.IO client connected');

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
