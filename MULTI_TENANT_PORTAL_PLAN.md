# Multi-Tenant Developer Portal & Zero-Touch Auto-Provisioning Blueprint (Workflow B)

## Overview
This document outlines the phased roadmap for upgrading `hikvision-event-receiver` into a **Multi-Tenant Platform** with **Zero-Touch Device Auto-Provisioning (Workflow B)** and a **Developer Web Portal**.

Under Workflow B:
1. HRMS clients sign up on the Developer Web Portal and receive a unique **Tenant Ingestion Key** (`tenantKey`).
2. HRMS clients set their Hikvision terminals to push events to:
   `https://api.yourdomain.com/api/webhooks/hikvision?tenantKey=tn_live_...`
3. The first HTTP push from any terminal automatically registers and binds that device to the tenant's account.
4. All subsequent events, API key queries, real-time WebSocket feeds, and outbound webhooks are isolated to that tenant.

---

## Architectural Breakdown & Phases

```
+----------------------------------------------------------------------------------------------------+
|                                    PHASED IMPLEMENTATION ROADMAP                                   |
+----------------------------------------------------------------------------------------------------+

  +-----------------------+     +-----------------------+     +-----------------------+
  | Phase 1: Database     | --> | Phase 2: Ingestion &  | --> | Phase 3: Auth &       |
  | Schema & Multi-Tenant |     | Auto-Provisioning     |     | Scoped APIs           |
  | Foundation            |     | (Workflow B Engine)   |     |                       |
  +-----------------------+     +-----------------------+     +-----------------------+
                                                                          |
  +-----------------------+     +-----------------------+                 |
  | Phase 5: Verification | <-- | Phase 4: Developer    | <---------------+
  | & End-to-End Tests    |     | Web Portal UI         |
  +-----------------------+     +-----------------------+
```

---

## Phase 1: Database Schema & Multi-Tenant Data Model

### 1.1 Update `src/database/schema.prisma`
Add `Tenants` model and add `tenantId` relationships to `Devices`, `Events`, `ApiKeys`, `WebhookSubscriptions`, and `AuditLogs`.

```prisma
model Tenants {
  id           String    @id @default(uuid())
  name         String    // Organization or HRMS Client name
  tenantKey    String    @unique // Ingestion secret e.g. "tn_live_a1b2c3d4..."
  email        String    @unique
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  devices              Devices[]
  events               Events[]
  apiKeys              ApiKeys[]
  webhookSubscriptions WebhookSubscriptions[]
  auditLogs            AuditLogs[]
}

model Devices {
  id              String    @id
  tenantId        String?
  tenant          Tenants?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name            String
  type            String    // "camera" | "face_terminal" | "door_controller"
  status          String    // "ONLINE" | "OFFLINE"
  firmwareVersion String
  lastEventAt     DateTime?

  @@index([tenantId])
  @@index([status])
  @@index([lastEventAt])
}

model Events {
  id            String   @id
  source        String   // "hikvision"
  tenantId      String?
  tenant        Tenants? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  deviceId      String
  eventType     String
  employeeId    String?
  employeeName  String?
  eventDedupKey String   @unique
  rawPayload    Json?
  auditMetadata Json?
  timestamp     DateTime
  createdAt     DateTime @default(now())

  @@index([tenantId, timestamp(sort: Desc)])
  @@index([timestamp(sort: Desc)])
  @@index([deviceId, timestamp(sort: Desc)])
  @@index([eventType, timestamp(sort: Desc)])
  @@index([employeeId])
}

model ApiKeys {
  id        String    @id @default(uuid())
  tenantId  String?
  tenant    Tenants?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  keyHash   String    @unique
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  expiresAt DateTime?

  @@index([tenantId])
}

model WebhookSubscriptions {
  id         String   @id @default(uuid())
  tenantId   String?
  tenant     Tenants? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  url        String
  secret     String
  eventTypes String[]
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([tenantId])
  @@index([isActive])
}

model AuditLogs {
  id        String   @id @default(uuid())
  tenantId  String?
  tenant    Tenants? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  action    String
  actorType String
  details   String
  createdAt DateTime @default(now())
}
```

### 1.2 Migration Plan
1. Generate Prisma Migration: `npx prisma migrate dev --name init_multi_tenancy`
2. Generate Prisma Client: `npx prisma generate`

---

## Phase 2: Ingestion & Auto-Provisioning Engine (Workflow B)

### 2.1 Webhook Receiver (`src/routes/webhooks.ts`)
* Extract `tenantKey` from query string (`req.query.tenantKey`) or header (`X-Tenant-Key`).
* Validate `tenantKey` against `Tenants` table.
* If `tenantKey` is missing or invalid:
  * Reject with `401 Unauthorized` or process as global/unassigned if configured.

### 2.2 Zero-Touch Device Auto-Provisioning Logic (`src/services/hikvisionService.ts`)
* When an event payload arrives:
  1. Extract `deviceId` (MAC / Serial number).
  2. Check if device exists in `Devices` table.
  3. If missing: Automatically register device under `tenantId` with status `ONLINE`.
  4. If device exists but has no `tenantId`: Assign `tenantId` to the device.
  5. Store event record attached to `tenantId`.

### 2.3 Real-Time WebSocket & Webhook Relay Scoping
* **Socket.IO (`src/websocket/broadcast.ts`)**:
  * Broadcast events to `tenant:<tenantId>` and `tenant:<tenantId>:device:<deviceId>` rooms.
* **Outbound Webhooks (`src/services/webhookService.ts`)**:
  * Filter `WebhookSubscriptions` where `subscription.tenantId == event.tenantId`.

---

## Phase 3: Auth & Management APIs

### 3.1 Tenant Authentication (`src/routes/tenantAuth.ts`)
* `POST /api/tenant/register`: Register new HRMS tenant account and generate `tenantKey`.
* `POST /api/tenant/login`: Login tenant user and return Tenant JWT token.
* `GET /api/tenant/me`: Return tenant profile & ingestion configuration URL.

### 3.2 Tenant API Key Management (`src/routes/apiKeys.ts`)
* Allow tenants (authenticated via Tenant JWT) to generate and manage API keys for their HRMS integration.
* Automatically assign `tenantId` to generated API keys.

### 3.3 Tenant Scoped Endpoints (`src/middleware/flexibleAuth.ts`)
* Enforce automatic query filtering in controllers:
  * `GET /api/events`: Scoped to `where: { tenantId: req.user.tenantId }`.
  * `GET /api/devices`: Scoped to `where: { tenantId: req.user.tenantId }`.
  * `GET /api/webhooks/subscriptions`: Scoped to `tenantId`.

---

## Phase 4: Developer Web Portal UI

Build a responsive UI portal hosted at `/portal` or `/dashboard`.

### Key Features of the Portal:
1. **Tenant Authentication Page**: Login / Registration for HRMS admins.
2. **Dashboard Overview**:
   * Total registered devices, active online status, and daily event counters.
   * **Zero-Touch Ingestion Setup Box**: Prominently displays the custom Webhook URL:
     `https://api.yourdomain.com/api/webhooks/hikvision?tenantKey=tn_live_...`
     with a 1-click copy button and step-by-step Hikvision hardware setup guide.
3. **API Keys Management**:
   * Generate new `X-API-Key` strings.
   * View key creation dates, expiration dates, and revoke inactive keys.
4. **Device Inventory**:
   * Table of auto-provisioned devices.
   * Edit device display name, type (`face_terminal`, `door_controller`, `camera`), and view live status (`ONLINE`/`OFFLINE`).
5. **Real-time Telemetry Live Feed**:
   * Live streaming list of incoming events using WebSockets (Socket.IO).
   * Filterable by event type (`CHECK_IN`, `DOOR_OPEN`, etc.).
6. **Outbound Webhook Subscriptions**:
   * Form to subscribe external HRMS endpoints to event streams.
   * View HMAC secret signatures and test webhook delivery.
7. **Interactive OpenAPI / Swagger Documentation**:
   * Embedded Swagger UI view for testing API endpoints directly.

---

## Phase 5: Verification & End-to-End Testing

### Test Scenarios:
1. **Tenant Registration**: Register Tenant A and Tenant B. Verify unique `tenantKey` generation.
2. **Workflow B Auto-Provisioning**:
   * Send HTTP POST to `/api/webhooks/hikvision?tenantKey=<TenantA_Key>` with payload for `DEV-A1`.
   * Verify `DEV-A1` is automatically created and assigned to Tenant A.
3. **Tenant Data Isolation**:
   * Query `GET /api/events` using Tenant A's API Key -> Ensure only `DEV-A1` events are returned.
   * Query `GET /api/events` using Tenant B's API Key -> Ensure `DEV-A1` events are NOT visible.
4. **Outbound Webhook Delivery Isolation**:
   * Register webhook for Tenant A. Trigger event for Tenant B device -> Ensure Tenant A webhook is NOT triggered.
5. **WebSocket Isolation**:
   * Connect Socket.IO client using Tenant A API Key -> Verify client only receives events for Tenant A devices.

---

## Current Status & Next Steps

* **Git Branch**: `feature/multi-tenant-portal` (Checked out)
* **Next Action**: Execute Phase 1 (Prisma Schema update and migration).
