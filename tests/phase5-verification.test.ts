import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { io as ioClient, Socket } from 'socket.io-client';
import app from '../app.js';
import { initSocketServer } from '../src/websocket/socket.js';
import { prisma } from '../src/database/prisma.js';

describe('Phase 5: Verification & End-to-End Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  let tenantAToken: string;
  let tenantAId: string;
  let tenantAKey: string;
  let tenantAApiKey: string;

  let tenantBToken: string;
  let tenantBId: string;
  let tenantBKey: string;
  let tenantBApiKey: string;

  let tenantAEventId: string;

  before(async () => {
    server = http.createServer(app);
    initSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Clean up previous test artifacts if any
    await prisma.events.deleteMany({
      where: { deviceId: { in: ['DEV-TEST-A1', 'DEV-TEST-B1'] } },
    });
    await prisma.devices.deleteMany({
      where: { id: { in: ['DEV-TEST-A1', 'DEV-TEST-B1'] } },
    });
    await prisma.tenants.deleteMany({
      where: { email: { in: ['tenanta_phase5@example.com', 'tenantb_phase5@example.com'] } },
    });
  });

  after(async () => {
    await prisma.events.deleteMany({
      where: { deviceId: { in: ['DEV-TEST-A1', 'DEV-TEST-B1'] } },
    });
    await prisma.devices.deleteMany({
      where: { id: { in: ['DEV-TEST-A1', 'DEV-TEST-B1'] } },
    });
    await prisma.tenants.deleteMany({
      where: { email: { in: ['tenanta_phase5@example.com', 'tenantb_phase5@example.com'] } },
    });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('Scenario 1: Tenant Registration & Unique Key Generation', async () => {
    // Register Tenant A
    const resA = await fetch(`${baseUrl}/api/tenant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tenant A Phase5 Org',
        email: 'tenanta_phase5@example.com',
        password: 'Password123!',
      }),
    });
    assert.strictEqual(resA.status, 201, 'Tenant A registration should return 201');
    const dataA = await resA.json();
    assert.ok(dataA.token, 'Tenant A token should exist');
    assert.ok(dataA.tenant.tenantKey.startsWith('tn_live_'), 'Tenant A key should have tn_live_ prefix');
    tenantAToken = dataA.token;
    tenantAId = dataA.tenant.id;
    tenantAKey = dataA.tenant.tenantKey;

    // Register Tenant B
    const resB = await fetch(`${baseUrl}/api/tenant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tenant B Phase5 Org',
        email: 'tenantb_phase5@example.com',
        password: 'Password123!',
      }),
    });
    assert.strictEqual(resB.status, 201, 'Tenant B registration should return 201');
    const dataB = await resB.json();
    assert.ok(dataB.token, 'Tenant B token should exist');
    assert.ok(dataB.tenant.tenantKey.startsWith('tn_live_'), 'Tenant B key should have tn_live_ prefix');
    tenantBToken = dataB.token;
    tenantBId = dataB.tenant.id;
    tenantBKey = dataB.tenant.tenantKey;

    assert.notStrictEqual(tenantAKey, tenantBKey, 'Tenant A and Tenant B keys must be distinct');
  });

  it('Scenario 2: Workflow B Zero-Touch Auto-Provisioning', async () => {
    const payload = {
      EventNotificationAlert: {
        macAddress: 'DEV-TEST-A1',
        eventType: 'AccessControlEvent',
        AccessControllerEvent: {
          minorEventType: 21,
          deviceName: 'Front Gate Terminal',
          employeeNoString: 'EMP1001',
          name: 'Alice Phase5',
        },
      },
    };

    const webhookRes = await fetch(`${baseUrl}/api/webhooks/hikvision?tenantKey=${tenantAKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(webhookRes.status, 200, 'Webhook ingestion should respond 200 OK');

    // Wait briefly for background setImmediate processing
    await new Promise((r) => setTimeout(r, 400));

    // Verify DEV-TEST-A1 was created and bound to Tenant A
    const device = await prisma.devices.findUnique({ where: { id: 'DEV-TEST-A1' } });
    assert.ok(device, 'Device DEV-TEST-A1 should be auto-provisioned in database');
    assert.strictEqual(device.tenantId, tenantAId, 'DEV-TEST-A1 tenantId should match Tenant A');
    assert.strictEqual(device.status, 'ONLINE', 'DEV-TEST-A1 status should be ONLINE');

    // Fetch Tenant A events to capture event ID
    const eventsRes = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${tenantAToken}` },
    });
    assert.strictEqual(eventsRes.status, 200);
    const eventsData = await eventsRes.json();
    assert.ok(eventsData.data.length > 0, 'Tenant A should have at least 1 ingested event');
    tenantAEventId = eventsData.data[0].id;
  });

  it('Scenario 3: Device Re-Binding Conflict Guard & Audit Logging', async () => {
    const payload = {
      EventNotificationAlert: {
        macAddress: 'DEV-TEST-A1',
        eventType: 'AccessControlEvent',
        AccessControllerEvent: {
          minorEventType: 21,
          deviceName: 'Front Gate Terminal Hijack Attempt',
          employeeNoString: 'EMP999',
          name: 'Attacker',
        },
      },
    };

    // Tenant B attempts to send event for DEV-TEST-A1
    const webhookRes = await fetch(`${baseUrl}/api/webhooks/hikvision?tenantKey=${tenantBKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(webhookRes.status, 200, 'Webhook receiver should acknowledge 200 OK');

    await new Promise((r) => setTimeout(r, 400));

    // Verify ownership of DEV-TEST-A1 was NOT hijacked by Tenant B
    const device = await prisma.devices.findUnique({ where: { id: 'DEV-TEST-A1' } });
    assert.strictEqual(device?.tenantId, tenantAId, 'DEV-TEST-A1 tenantId must remain Tenant A');

    // Verify UNAUTHORIZED_DEVICE_TENANT_MISMATCH audit log entry
    const auditLog = await prisma.auditLogs.findFirst({
      where: {
        action: 'UNAUTHORIZED_DEVICE_TENANT_MISMATCH',
        tenantId: tenantBId,
      },
    });
    assert.ok(auditLog, 'UNAUTHORIZED_DEVICE_TENANT_MISMATCH audit log must be created');
    assert.ok(auditLog.details.includes('DEV-TEST-A1'), 'Audit log details should mention DEV-TEST-A1');
  });

  it('Scenario 4: Tenant Data & API Isolation (IDOR Checks)', async () => {
    // Generate API Key for Tenant A
    const apiKeyResA = await fetch(`${baseUrl}/api/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantAToken}`,
      },
      body: JSON.stringify({ name: 'Tenant A Key' }),
    });
    assert.strictEqual(apiKeyResA.status, 201);
    const keyDataA = await apiKeyResA.json();
    tenantAApiKey = keyDataA.apiKey;

    // Generate API Key for Tenant B
    const apiKeyResB = await fetch(`${baseUrl}/api/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantBToken}`,
      },
      body: JSON.stringify({ name: 'Tenant B Key' }),
    });
    assert.strictEqual(apiKeyResB.status, 201);
    const keyDataB = await apiKeyResB.json();
    tenantBApiKey = keyDataB.apiKey;

    // 1. Query GET /api/events with Tenant A API key
    const resEventsA = await fetch(`${baseUrl}/api/events`, {
      headers: { 'X-API-Key': tenantAApiKey },
    });
    assert.strictEqual(resEventsA.status, 200);
    const eventsAData = await resEventsA.json();
    assert.ok(
      eventsAData.data.some((e: any) => e.deviceId === 'DEV-TEST-A1'),
      "Tenant A events list should include DEV-TEST-A1's event"
    );

    // 2. Query GET /api/events with Tenant B API key -> Must not contain Tenant A events
    const resEventsB = await fetch(`${baseUrl}/api/events`, {
      headers: { 'X-API-Key': tenantBApiKey },
    });
    assert.strictEqual(resEventsB.status, 200);
    const eventsBData = await resEventsB.json();
    assert.ok(
      !eventsBData.data.some((e: any) => e.deviceId === 'DEV-TEST-A1'),
      "Tenant B events list MUST NOT include Tenant A's events"
    );

    // 3. IDOR Check: Query GET /api/events/:id (Tenant A event) using Tenant B's API key -> Must return 404
    const resIdor = await fetch(`${baseUrl}/api/events/${tenantAEventId}`, {
      headers: { 'X-API-Key': tenantBApiKey },
    });
    assert.strictEqual(resIdor.status, 404, 'Querying Tenant A event with Tenant B API key must return 404 Not Found');
  });

  it('Scenario 5: Outbound Webhook Delivery Isolation', async () => {
    // Register Webhook Subscription for Tenant A
    const subRes = await fetch(`${baseUrl}/api/webhooks/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantAToken}`,
      },
      body: JSON.stringify({
        url: 'https://example.com/tenant-a-webhook',
        eventTypes: ['*'],
      }),
    });
    assert.strictEqual(subRes.status, 201);

    // Ingest event for Tenant B on DEV-TEST-B1
    const payloadB = {
      EventNotificationAlert: {
        macAddress: 'DEV-TEST-B1',
        eventType: 'AccessControlEvent',
        AccessControllerEvent: {
          minorEventType: 21,
          deviceName: 'Tenant B Gate',
          employeeNoString: 'EMP2001',
          name: 'Bob Phase5',
        },
      },
    };

    await fetch(`${baseUrl}/api/webhooks/hikvision?tenantKey=${tenantBKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadB),
    });

    await new Promise((r) => setTimeout(r, 400));

    // Verify Tenant A webhook subscription was NOT triggered for Tenant B's event
    const pendingDeliveriesA = await prisma.pendingWebhookDeliveries.findMany({
      where: { tenantId: tenantAId },
    });

    assert.strictEqual(
      pendingDeliveriesA.length,
      0,
      "Tenant A's webhook subscription must NOT receive deliveries for Tenant B's events"
    );
  });

  it('Scenario 6: WebSocket Room Security', async () => {
    const socket: Socket = ioClient(baseUrl, {
      auth: { token: tenantBToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 3000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Attempt to join Tenant A room using Tenant B's socket connection
    const errorPromise = new Promise<{ message: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Expected error event timeout')), 3000);
      socket.on('error', (errData: any) => {
        clearTimeout(timeout);
        resolve(errData);
      });
    });

    socket.emit('subscribe', `tenant:${tenantAId}`);

    const errorResult = await errorPromise;
    assert.ok(
      errorResult.message.includes('Unauthorized'),
      'Socket subscription to foreign tenant room must be rejected with Unauthorized'
    );

    socket.disconnect();
  });
});
