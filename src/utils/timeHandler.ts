import { env } from '../config/env.js';
import { logger } from './logger.js';

export function parseDateTimeInTimezone(dateTimeStr: string, timeZone: string): Date {
  if (!dateTimeStr) return new Date();

  const trimmed = dateTimeStr.trim();
  if (/Z|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const [_, year, month, day, hour, minute, second, ms] = match;
  
  const utcTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    ms ? Number(ms.padEnd(3, '0').slice(0, 3)) : 0
  );

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const refDate = new Date(utcTime);
    const parts = formatter.formatToParts(refDate);
    
    const getPartVal = (type: string) => Number(parts.find(p => p.type === type)?.value);
    
    const formattedHour = getPartVal('hour');
    const hr = formattedHour === 24 ? 0 : formattedHour;

    const localRef = Date.UTC(
      getPartVal('year'),
      getPartVal('month') - 1,
      getPartVal('day'),
      hr,
      getPartVal('minute'),
      getPartVal('second')
    );

    const offset = localRef - utcTime;
    return new Date(utcTime - offset);
  } catch (error) {
    logger.warn({ error, dateTimeStr, timeZone }, 'Failed to parse timezone offset using Intl, falling back to local server parsing');
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? new Date() : d;
  }
}

export function formatLocalISO(date: Date, timeZone: string = env.TIMEZONE || 'Africa/Nairobi'): string {
  try {
    const tz = (timeZone && timeZone !== 'UTC') ? timeZone : 'Africa/Nairobi';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (t: string) => parts.find(p => p.type === t)?.value || '00';
    const yr = getPart('year');
    const mo = getPart('month');
    const dy = getPart('day');
    const rawHr = getPart('hour');
    const hr = rawHr === '24' ? '00' : rawHr;
    const mn = getPart('minute');
    const sc = getPart('second');

    const utcDate = new Date(date.getTime());
    const tzDateStr = date.toLocaleString('en-US', { timeZone: tz });
    const localDate = new Date(tzDateStr);
    const diffMinutes = Math.round((localDate.getTime() - utcDate.getTime()) / (1000 * 60));
    const sign = diffMinutes >= 0 ? '+' : '-';
    const absDiff = Math.abs(diffMinutes);
    const offHr = String(Math.floor(absDiff / 60)).padStart(2, '0');
    const offMn = String(absDiff % 60).padStart(2, '0');

    return `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${sign}${offHr}:${offMn}`;
  } catch {
    return date.toISOString();
  }
}

export function handleClockSkew(
  eventTimestamp: Date,
  serverTime: Date = new Date()
): { timestamp: Date; skewSeconds: number; action: 'none' | 'normalized' | 'rejected' } {
  const skewMs = serverTime.getTime() - eventTimestamp.getTime();
  const skewSeconds = Math.round(skewMs / 1000);

  const maxFuture = env.MAX_FUTURE_SKEW_SECONDS;
  const maxPast = env.MAX_PAST_SKEW_SECONDS;

  const isTooFarFuture = skewSeconds < -maxFuture;
  const isTooFarPast = skewSeconds > maxPast;

  if (isTooFarFuture || isTooFarPast) {
    logger.warn(
      {
        eventTimestamp,
        serverTime,
        skewSeconds,
        policy: env.CLOCK_SKEW_POLICY,
        maxFuture,
        maxPast,
      },
      'Event timestamp is out of bounds (clock skew detected)'
    );

    if (env.CLOCK_SKEW_POLICY === 'reject') {
      return {
        timestamp: eventTimestamp,
        skewSeconds,
        action: 'rejected',
      };
    } else if (env.CLOCK_SKEW_POLICY === 'normalize') {
      return {
        timestamp: serverTime,
        skewSeconds,
        action: 'normalized',
      };
    }
  }

  return {
    timestamp: eventTimestamp,
    skewSeconds,
    action: 'none',
  };
}
