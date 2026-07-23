import { Resend } from 'resend';
import { env } from '../config/env.js';
import pino from 'pino';

const logger = pino({ name: 'emailService' });

export class EmailService {
  private resend: Resend | null = null;

  constructor() {
    if (env.RESEND_API_KEY) {
      this.resend = new Resend(env.RESEND_API_KEY);
    }
  }

  public async sendPasswordResetEmail(email: string, resetLink: string, tenantName?: string): Promise<boolean> {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0A1931; color: #F6FAFD; padding: 20px; }
          .card { background-color: #122A4A; border: 1px solid #1A3D63; border-radius: 12px; max-width: 540px; margin: 0 auto; padding: 30px; }
          .brand { color: #4A7FA7; font-size: 20px; font-weight: bold; margin-bottom: 20px; }
          .button { display: inline-block; background-color: #4A7FA7; color: #0A1931; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 20px 0; }
          .footer { font-size: 12px; color: #B3CFE5; margin-top: 30px; border-top: 1px solid #1A3D63; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="brand">Hikvision Event API</div>
          <h2>Password Reset Request</h2>
          <p>Hello ${tenantName || 'User'},</p>
          <p>We received a request to reset the password for your account (<strong>${email}</strong>).</p>
          <p>Click the button below to reset your password. This link is valid for <strong>1 hour</strong>:</p>
          <p><a href="${resetLink}" class="button" target="_blank">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p style="word-break: break-all; color: #B3CFE5; font-family: monospace;">${resetLink}</p>
          <p>If you did not request a password reset, you can safely ignore this email.</p>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Hikvision Event Telemetry API. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;

    if (!this.resend) {
      logger.info({ email, resetLink }, '[DEV/TEST] Resend API key not configured. Password reset link generated');
      return true;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: env.EMAIL_FROM,
        to: email,
        subject: 'Reset Your Password - Hikvision Event API',
        html: htmlContent,
      });

      if (error) {
        logger.error({ error, email }, 'Failed to send password reset email via Resend');
        return false;
      }

      logger.info({ email, emailId: data?.id }, 'Successfully sent password reset email via Resend');
      return true;
    } catch (err) {
      logger.error({ err, email }, 'Error invoking Resend email service');
      return false;
    }
  }
}

export const emailService = new EmailService();
