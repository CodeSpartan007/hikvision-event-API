export interface NormalizedEvent {
  id: string;
  source: string;
  deviceId: string;
  deviceType: 'camera' | 'face_terminal' | 'door_controller';
  eventType: 'CHECK_IN' | 'CHECK_OUT' | 'MOTION' | 'DOOR_OPEN' | 'DOOR_CLOSED' | 'DOOR_FORCED' | 'CAMERA_OFFLINE' | 'HEARTBEAT' | 'UNKNOWN';
  employeeId?: string;
  externalEmployeeId?: string;
  timestamp: Date;
  rawPayload: unknown;
}
