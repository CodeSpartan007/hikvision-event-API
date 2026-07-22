import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import { NormalizedEvent } from '../models/normalizedEvent.js';
import { env } from '../config/env.js';
import { parseDateTimeInTimezone } from '../utils/timeHandler.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function extractAlertObject(payload: unknown): any {
  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractAlertObject(parsed);
      } catch {
        // Fallback
      }
    }
    try {
      const parsed = xmlParser.parse(trimmed);
      return extractAlertObject(parsed);
    } catch {
      return null;
    }
  }

  if (Buffer.isBuffer(payload)) {
    return extractAlertObject(payload.toString('utf-8'));
  }

  if (typeof payload === 'object') {
    if ('EventNotificationAlert' in payload) {
      return (payload as any).EventNotificationAlert;
    }

    if ('eventType' in payload || 'macAddress' in payload || 'ipAddress' in payload) {
      return payload;
    }

    const itemsToInspect: unknown[] = [];
    if (Array.isArray(payload)) {
      itemsToInspect.push(...payload);
    } else {
      for (const key of Object.keys(payload)) {
        itemsToInspect.push((payload as any)[key]);
      }
    }

    for (const value of itemsToInspect) {
      if (!value) continue;
      if (typeof value === 'string' || Buffer.isBuffer(value)) {
        const strVal = Buffer.isBuffer(value) ? value.toString('utf-8') : value;
        const trimmed = strVal.trim();
        if (trimmed.startsWith('<') || trimmed.startsWith('{') || trimmed.includes('<EventNotificationAlert')) {
          const parsed = extractAlertObject(trimmed);
          if (parsed) {
            return parsed;
          }
        }
      } else if (typeof value === 'object') {
        if ('buffer' in value && Buffer.isBuffer((value as any).buffer)) {
          const parsed = extractAlertObject((value as any).buffer);
          if (parsed) return parsed;
        } else {
          const parsed = extractAlertObject(value);
          if (parsed) return parsed;
        }
      }
    }
  }

  return null;
}

export function parseHikvisionEvent(payload: unknown): NormalizedEvent {
  const alert = extractAlertObject(payload);
  const eventId = randomUUID();
  const timestamp = alert?.dateTime ? parseDateTimeInTimezone(alert.dateTime, env.TIMEZONE) : new Date();

  if (!alert) {
    return {
      id: eventId,
      source: 'hikvision',
      deviceId: 'unknown-device',
      deviceType: 'camera',
      eventType: 'UNKNOWN',
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      rawPayload: payload,
    };
  }

  const ipAddress = alert.ipAddress ? String(alert.ipAddress).trim() : '';
  const macAddress = alert.macAddress ? String(alert.macAddress).trim() : '';
  const serialNo = (
    alert.deviceSerialNo ||
    alert.serialNo ||
    alert.subSerialNum ||
    alert.AccessControllerEvent?.serialNo
  ) ? String(
    alert.deviceSerialNo ||
    alert.serialNo ||
    alert.subSerialNum ||
    alert.AccessControllerEvent?.serialNo
  ).trim() : '';

  const deviceId = macAddress || serialNo || ipAddress || 'unknown-device';

  const rawEventType = String(alert.eventType || '').trim();
  const rawEventDesc = String(alert.eventDescription || '').trim().toLowerCase();

  let eventType: NormalizedEvent['eventType'] = 'UNKNOWN';
  let deviceType: NormalizedEvent['deviceType'] = 'camera';
  let employeeId: string | undefined = undefined;
  let employeeName: string | undefined = undefined;

  const accessEvent = alert.AccessControllerEvent;

  if (rawEventType.toLowerCase() === 'accesscontrollerevent' || accessEvent) {
    const minorType = accessEvent ? Number(accessEvent.minorEventType ?? accessEvent.subEventType) : undefined;
    const verifyMode = accessEvent ? String(accessEvent.currentVerifyMode || '').toLowerCase() : '';
    const attendanceStatus = accessEvent ? String(accessEvent.attendanceStatus || '').toLowerCase() : '';

    if (
      minorType === 21 ||
      minorType === 22 ||
      minorType === 25
    ) {
      deviceType = 'door_controller';
    } else if (
      verifyMode === 'face' ||
      verifyMode === 'fingerprint' ||
      verifyMode === 'card' ||
      verifyMode === 'cardorfaceorfp'
    ) {
      deviceType = 'face_terminal';
    } else {
      const devName = String(accessEvent?.deviceName || '').toLowerCase();
      if (devName.includes('door') || rawEventDesc.includes('door')) {
        deviceType = 'door_controller';
      } else {
        deviceType = 'face_terminal';
      }
    }

    const majorType = accessEvent ? Number(accessEvent.majorEventType) : undefined;

    if (minorType === 21) {
      eventType = 'DOOR_OPEN';
    } else if (minorType === 22) {
      eventType = 'DOOR_CLOSED';
    } else if (minorType === 25 || rawEventDesc.includes('forced')) {
      eventType = 'DOOR_FORCED';
    } else if (majorType === 2 && minorType === 39) {
      eventType = 'DOOR_OPEN';
    } else if (
      minorType === 75 ||
      minorType === 38 ||
      (minorType === 39 && majorType === 5) ||
      minorType === 50 ||
      minorType === 104 ||
      verifyMode === 'face' ||
      verifyMode === 'fingerprint' ||
      verifyMode === 'card' ||
      verifyMode === 'cardorfaceorfp'
    ) {
      if (attendanceStatus === 'checkin') {
        eventType = 'CHECK_IN';
      } else if (attendanceStatus === 'checkout') {
        eventType = 'CHECK_OUT';
      } else {
        eventType = 'CHECK_IN';
      }
    } else {
      if (rawEventDesc.includes('forced') || rawEventDesc.includes('illegal')) {
        eventType = 'DOOR_FORCED';
      } else if (rawEventDesc.includes('door open') || rawEventDesc.includes('door_open')) {
        eventType = 'DOOR_OPEN';
      } else if (
        rawEventDesc.includes('door close') ||
        rawEventDesc.includes('door_close') ||
        rawEventDesc.includes('door closed')
      ) {
        eventType = 'DOOR_CLOSED';
      }
    }

    const empNo = [
      accessEvent?.employeeNoString,
      accessEvent?.employeeNo,
      accessEvent?.externalEmployeeId,
      accessEvent?.externalemployeeid,
      accessEvent?.employeeID,
      accessEvent?.employeeId,
      alert?.employeeNoString,
      alert?.employeeNo,
      alert?.externalEmployeeId,
      alert?.externalemployeeid,
      alert?.employeeID,
      alert?.employeeId,
    ]
      .map((value) => String(value ?? '').trim())
      .find((value) => value !== '' && value !== '0');
    if (empNo) {
      employeeId = empNo;
    }

    const empName = [
      accessEvent?.name,
      accessEvent?.employeeName,
      accessEvent?.userName,
      accessEvent?.staffName,
      alert?.name,
      alert?.employeeName,
      alert?.userName,
      alert?.staffName,
    ]
      .map((value) => String(value ?? '').trim())
      .find((value) => value !== '');
    if (empName) {
      employeeName = empName;
    }
  } else {
    const typeLower = rawEventType.toLowerCase();

    if (
      typeLower === 'videoloss' ||
      typeLower === 'motion' ||
      typeLower === 'linecrossing' ||
      rawEventDesc.includes('motion') ||
      rawEventDesc.includes('line crossing') ||
      rawEventDesc.includes('linecrossing')
    ) {
      eventType = 'MOTION';
      deviceType = 'camera';
    } else if (typeLower === 'devicestatus' || rawEventDesc.includes('offline') || rawEventDesc.includes('disconnected')) {
      const state = String(alert.eventState || '').toLowerCase();
      if (
        state === 'inactive' ||
        rawEventDesc.includes('offline') ||
        rawEventDesc.includes('disconnection') ||
        rawEventDesc.includes('disconnected')
      ) {
        eventType = 'CAMERA_OFFLINE';
      }
      deviceType = 'camera';
    } else if (typeLower === 'heartbeat' || rawEventDesc.includes('heartbeat')) {
      eventType = 'HEARTBEAT';
      const devName = String(alert.AccessControllerEvent?.deviceName || '').toLowerCase();
      if (devName.includes('door') || rawEventDesc.includes('door')) {
        deviceType = 'door_controller';
      } else {
        deviceType = 'face_terminal';
      }
    } else {
      eventType = 'UNKNOWN';
      if (rawEventDesc.includes('camera') || rawEventDesc.includes('video')) {
        deviceType = 'camera';
      } else if (rawEventDesc.includes('door')) {
        deviceType = 'door_controller';
      } else if (rawEventDesc.includes('face') || rawEventDesc.includes('terminal')) {
        deviceType = 'face_terminal';
      } else {
        deviceType = 'camera';
      }
    }
  }

  const finalTimestamp = isNaN(timestamp.getTime()) ? new Date() : timestamp;

  return {
    id: eventId,
    source: 'hikvision',
    deviceId,
    deviceType,
    eventType,
    employeeId,
    employeeName,
    timestamp: finalTimestamp,
    rawPayload: payload,
  };
}
