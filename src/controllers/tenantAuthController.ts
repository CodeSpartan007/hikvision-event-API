import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';

import { emailService } from '../services/emailService.js';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${hash}:${salt}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [hash, salt] = storedHash.split(':');
  if (!hash || !salt) return false;
  const key = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key);
  const hashBuffer = Buffer.from(hash, 'hex');
  return keyBuffer.length === hashBuffer.length && crypto.timingSafeEqual(keyBuffer, hashBuffer);
}

export class TenantAuthController {
  public register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, email, password } = registerSchema.parse(req.body);

      const existingTenant = await prisma.tenants.findUnique({ where: { email } });
      if (existingTenant) {
        res.status(409).json({ error: 'Conflict', message: 'Tenant email already registered' });
        return;
      }

      const passwordHash = hashPassword(password);
      const tenantKey = 'tn_live_' + crypto.randomBytes(24).toString('hex');

      const tenant = await prisma.tenants.create({
        data: {
          name,
          email,
          passwordHash,
          tenantKey,
        },
      });

      const token = jwt.sign(
        { tenantId: tenant.id, email: tenant.email, name: tenant.name, role: 'TENANT_ADMIN' },
        env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        message: 'Tenant registered successfully',
        token,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          tenantKey: tenant.tenantKey,
          createdAt: tenant.createdAt,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const tenant = await prisma.tenants.findUnique({ where: { email } });
      if (!tenant) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const isValidPassword = verifyPassword(password, tenant.passwordHash);
      if (!isValidPassword) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const token = jwt.sign(
        { tenantId: tenant.id, email: tenant.email, name: tenant.name, role: 'TENANT_ADMIN' },
        env.JWT_SECRET!,
        { expiresIn: '24h' }
      );

      res.status(200).json({
        token,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          tenantKey: tenant.tenantKey,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);

      const tenant = await prisma.tenants.findUnique({ where: { email } });
      if (tenant) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await prisma.tenants.update({
          where: { id: tenant.id },
          data: {
            resetPasswordToken: tokenHash,
            resetPasswordExpires: expiresAt,
          },
        });

        const protocol = req.protocol || 'http';
        let host = req.headers.host || 'hikvision-events.duckdns.org';
        if (env.APP_BASE_URL) {
          host = env.APP_BASE_URL.replace(/^https?:\/\//, '');
        }
        const resetLink = `${protocol}://${host}/?resetToken=${rawToken}`;

        await emailService.sendPasswordResetEmail(email, resetLink, tenant.name);

        await prisma.auditLogs.create({
          data: {
            tenantId: tenant.id,
            action: 'FORGOT_PASSWORD_REQUESTED',
            actorType: 'TENANT_ADMIN',
            details: `Password reset link requested for email: ${email}`,
          },
        });
      }

      res.status(200).json({
        message: 'If an account with that email exists, password reset instructions have been sent.',
      });
    } catch (err) {
      next(err);
    }
  };

  public resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const tenant = await prisma.tenants.findFirst({
        where: {
          resetPasswordToken: tokenHash,
          resetPasswordExpires: {
            gt: new Date(),
          },
        },
      });

      if (!tenant) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid or expired password reset token',
        });
        return;
      }

      const passwordHash = hashPassword(newPassword);

      await prisma.tenants.update({
        where: { id: tenant.id },
        data: {
          passwordHash,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });

      await prisma.auditLogs.create({
        data: {
          tenantId: tenant.id,
          action: 'PASSWORD_RESET_COMPLETED',
          actorType: 'TENANT_ADMIN',
          details: `Password reset completed successfully for email: ${tenant.email}`,
        },
      });

      res.status(200).json({
        message: 'Password updated successfully. You may now log in with your new password.',
      });
    } catch (err) {
      next(err);
    }
  };

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'Bad Request', message: 'No tenant context associated with current user session' });
        return;
      }

      const tenant = await prisma.tenants.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          tenantKey: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!tenant) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant profile not found' });
        return;
      }

      const protocol = req.protocol || 'http';
      let host = req.headers.host || 'hikvision-events.duckdns.org';
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        host = 'hikvision-events.duckdns.org';
      }
      const ingestionUrl = `${protocol}://${host}/api/webhooks/hikvision?tenantKey=${tenant.tenantKey}`;

      res.status(200).json({
        tenant,
        ingestionUrl,
      });
    } catch (err) {
      next(err);
    }
  };

  public deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: 'Bad Request', message: 'No tenant context associated with current user session' });
        return;
      }

      const tenant = await prisma.tenants.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant account not found' });
        return;
      }

      // Cascade delete permanently removes all Devices, Events, ApiKeys, WebhookSubscriptions, PendingWebhookDeliveries, AuditLogs
      await prisma.tenants.delete({
        where: { id: tenantId },
      });

      res.status(200).json({
        message: 'Account and all associated tenant data permanently deleted.',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const tenantAuthController = new TenantAuthController();
