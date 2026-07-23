import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import app from '../app.js';
import { prisma } from '../src/database/prisma.js';

describe('Password Reset with Resend Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  const testEmail = 'pwd_reset_test@example.com';
  const initialPassword = 'oldpassword123';
  const newPassword = 'newpassword123';

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    await prisma.tenants.deleteMany({
      where: { email: testEmail },
    });
  });

  after(async () => {
    await prisma.tenants.deleteMany({
      where: { email: testEmail },
    });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. Registers a new tenant user', async () => {
    const res = await fetch(`${baseUrl}/api/tenant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Reset Test Corp',
        email: testEmail,
        password: initialPassword,
      }),
    });

    assert.strictEqual(res.status, 201);
  });

  it('2. Requests password reset for non-existent email (secure 200 response)', async () => {
    const res = await fetch(`${baseUrl}/api/tenant/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /password reset instructions/i);
  });

  it('3. Requests password reset for existing tenant and verifies DB token generation', async () => {
    const res = await fetch(`${baseUrl}/api/tenant/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /password reset instructions/i);

    const tenant = await prisma.tenants.findUnique({ where: { email: testEmail } });
    assert.ok(tenant?.resetPasswordToken);
    assert.ok(tenant?.resetPasswordExpires);
    assert.ok(tenant.resetPasswordExpires > new Date());
  });

  it('4. Rejects password reset with invalid token', async () => {
    const res = await fetch(`${baseUrl}/api/tenant/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'invalid_raw_token',
        newPassword: newPassword,
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Bad Request');
  });

  it('5. Successfully resets password with valid token and logs in with new password', async () => {
    const crypto = await import('node:crypto');
    const rawToken = 'test_token_' + crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.tenants.update({
      where: { email: testEmail },
      data: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: new Date(Date.now() + 3600 * 1000),
      },
    });

    const resetRes = await fetch(`${baseUrl}/api/tenant/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rawToken,
        newPassword: newPassword,
      }),
    });

    assert.strictEqual(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.match(resetData.message, /Password updated successfully/i);

    const updatedTenant = await prisma.tenants.findUnique({ where: { email: testEmail } });
    assert.strictEqual(updatedTenant?.resetPasswordToken, null);
    assert.strictEqual(updatedTenant?.resetPasswordExpires, null);

    const oldLoginRes = await fetch(`${baseUrl}/api/tenant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: initialPassword,
      }),
    });
    assert.strictEqual(oldLoginRes.status, 401);

    const newLoginRes = await fetch(`${baseUrl}/api/tenant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: newPassword,
      }),
    });
    assert.strictEqual(newLoginRes.status, 200);
    const loginData = await newLoginRes.json();
    assert.ok(loginData.token);
  });

  it('6. Permanently deletes tenant account and all cascade data via DELETE /api/tenant/me', async () => {
    const loginRes = await fetch(`${baseUrl}/api/tenant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: newPassword,
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    const tenant = await prisma.tenants.findUnique({ where: { email: testEmail } });
    assert.ok(tenant);

    await prisma.devices.create({
      data: {
        id: 'DEV-DELETE-TEST',
        tenantId: tenant.id,
        name: 'Delete Test Device',
        type: 'camera',
        status: 'ONLINE',
        firmwareVersion: 'v1.0',
      },
    });

    const deleteRes = await fetch(`${baseUrl}/api/tenant/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(deleteRes.status, 200);

    const deletedTenant = await prisma.tenants.findUnique({ where: { email: testEmail } });
    assert.strictEqual(deletedTenant, null);

    const deletedDevice = await prisma.devices.findUnique({ where: { id: 'DEV-DELETE-TEST' } });
    assert.strictEqual(deletedDevice, null);
  });
});
