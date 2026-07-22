import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

export function httpsRedirect(req: Request, res: Response, next: NextFunction): void {
  if (!env.ENFORCE_HTTPS) {
    next();
    return;
  }

  if (req.secure) {
    next();
    return;
  }

  const isHealthBypass = req.path === '/health' || req.path.startsWith('/health/');
  const isWebhooksBypass = req.path === '/api/webhooks' || req.path.startsWith('/api/webhooks/');
  if (isHealthBypass || isWebhooksBypass) {
    next();
    return;
  }

  const hostHeader = req.headers.host;
  if (!hostHeader || typeof hostHeader !== 'string') {
    next();
    return;
  }

  const hostRegex = /^[a-zA-Z0-9-.:]+$/;
  if (!hostRegex.test(hostHeader)) {
    next();
    return;
  }

  const allowedHosts = (env.ALLOWED_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

  const hostNameOnly = hostHeader.split(':')[0].toLowerCase();
  const hostHeaderLower = hostHeader.toLowerCase();

  const isApproved = allowedHosts.includes(hostNameOnly) || allowedHosts.includes(hostHeaderLower);
  if (!isApproved) {
    next();
    return;
  }

  res.redirect(301, `https://${hostHeader}${req.url}`);
}
