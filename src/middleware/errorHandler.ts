import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({
    err,
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    }
  }, 'An error occurred during request processing');

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') {
    const prismaErr = err as { code: string; message: string };
    if (prismaErr.code === 'P2025') {
      const isCursorErr = prismaErr.message?.includes('cursor');
      res.status(isCursorErr ? 400 : 404).json({
        status: 'error',
        message: isCursorErr ? 'Invalid cursor provided for pagination' : 'Requested record was not found',
      });
      return;
    }
    if (prismaErr.code === 'P2002') {
      res.status(409).json({
        status: 'error',
        message: 'A record with this key already exists',
      });
      return;
    }
  }

  const isProduction = env.NODE_ENV === 'production';
  res.status(500).json({
    status: 'error',
    message: isProduction ? 'Internal Server Error' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
