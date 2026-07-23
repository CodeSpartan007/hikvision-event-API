import { Resend } from 'resend';
import { env } from '../config/env.js';
import pino from 'pino';

const logger = pino({ name: 'emailService' });

export class EmailService {
  private resend: Resend | null = null;

  private getResendClient(): Resend | null {
    const apiKey = env.RESEND_API_KEY || process.env.RESEND_API_KEY;
    if (!apiKey) {
      return null;
    }
    if (!this.resend) {
      this.resend = new Resend(apiKey);
    }
    return this.resend;
  }

  public async sendPasswordResetEmail(email: string, resetLink: string, tenantName?: string): Promise<boolean> {
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: hidden;">
                
                <!-- Header Banner -->
                <tr>
                  <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
                    <span style="color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Hikvision Event API</span>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 32px; color: #1e293b; font-size: 15px; line-height: 1.6;">
                    <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.01em;">Password Reset Request</h2>
                    <p style="margin: 0 0 16px 0; color: #334155;">Hello <strong>${tenantName || 'User'}</strong>,</p>
                    <p style="margin: 0 0 20px 0; color: #334155;">We received a request to reset the password for your account (<strong style="color: #0f172a;">${email}</strong>).</p>
                    <p style="margin: 0 0 24px 0; color: #334155;">Click the button below to set a new password. This link is valid for <strong>1 hour</strong>:</p>

                    <!-- Reset Button -->
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 28px 0;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #1e40af;">
                          <a href="${resetLink}" target="_blank" style="font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 14px 28px; border-radius: 8px; background-color: #1e40af; border: 1px solid #1e40af;">Reset Password &rarr;</a>
                        </td>
                      </tr>
                    </table>

                    <!-- Alternative Link Box -->
                    <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; font-weight: 600;">Or copy and paste this URL into your browser:</p>
                    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; word-break: break-all; margin-bottom: 24px;">
                      <a href="${resetLink}" target="_blank" style="color: #2563eb; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; text-decoration: underline;">${resetLink}</a>
                    </div>

                    <p style="margin: 0; font-size: 14px; color: #64748b;">If you did not request a password reset, you can safely ignore this email.</p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 12px;">
                    &copy; ${new Date().getFullYear()} Hikvision Event Telemetry API. All rights reserved.
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const resendClient = this.getResendClient();

    if (!resendClient) {
      logger.info({ email, resetLink }, '[DEV/TEST] Resend API key not configured. Password reset link generated');
      return true;
    }

    try {
      const fromEmail = env.EMAIL_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev';
      const { data, error } = await resendClient.emails.send({
        from: fromEmail,
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
