import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';

export function isPrivateOrReservedIP(ip: string): boolean {
  if (!net.isIP(ip)) {
    return true;
  }

  let checkIp = ip;
  if (checkIp.startsWith('::ffff:')) {
    checkIp = checkIp.substring(7);
  }

  if (net.isIPv4(checkIp)) {
    const parts = checkIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    if (parts[0] === 0) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] >= 224) return true;

    return false;
  }

  if (net.isIPv6(checkIp)) {
    const normalized = checkIp.toLowerCase();
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

    return false;
  }

  return true;
}

export async function validateSafeWebhookUrl(urlStr: string): Promise<{ valid: boolean; reason?: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch (err) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  const isProduction = env.NODE_ENV === 'production' && process.env.NODE_ENV !== 'test';
  const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV !== 'test';

  if (isProduction && parsedUrl.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook URL must use HTTPS in production' };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook URL scheme must be HTTP or HTTPS' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (isTest || env.NODE_ENV === 'development') {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { valid: true };
    }
  }

  if (hostname === 'localhost') {
    return { valid: false, reason: 'Webhook target cannot be localhost' };
  }

  try {
    let resolvedIPs: string[] = [];
    if (net.isIP(hostname)) {
      resolvedIPs = [hostname];
    } else {
      const lookups = await dns.lookup(hostname, { all: true });
      resolvedIPs = lookups.map((l) => l.address);
    }

    if (resolvedIPs.length === 0) {
      return { valid: false, reason: 'Failed to resolve hostname to IP address' };
    }

    for (const ip of resolvedIPs) {
      if (isPrivateOrReservedIP(ip)) {
        return { valid: false, reason: `Target IP address ${ip} is in a private or reserved network range` };
      }
    }
  } catch (dnsErr) {
    return { valid: false, reason: 'Failed DNS resolution for webhook target' };
  }

  return { valid: true };
}
