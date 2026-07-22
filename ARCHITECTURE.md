# Architectural Reference & How It Works

## System Overview

`hikvision-event-receiver` is a lightweight, high-performance microservice designed specifically for **real-time event ingestion, parsing, deduplication, and streaming** from Hikvision access control terminals, door controllers, and IP cameras.

Unlike a monolithic attendance system, this service focuses **100% on telemetry and event delivery**

```
+--------------------------------------------------------------------------------------------------+
|                                    EVENT INGESTION FLOW                                          |
+--------------------------------------------------------------------------------------------------+

  +-------------------------------+
  | Hikvision Device (HTTP Push)  |
  +---------------+---------------+
                  |
                  | 1. HTTP POST (Multipart MIME / XML / JSON)
                  v
  +-------------------------------+
  |  Express Webhook Controller   |
  +---------------+---------------+
                  |
                  | 2. Multer & Parser
                  v
  +-------------------------------+
  |    ISAPI Payload Parser       | ---> Maps vendor XML/JSON to NormalizedEvent
  +---------------+---------------+
                  |
                  | 3. Clock Skew Policy & Deduplication Check
                  v
  +-------------------------------+
  |  PostgreSQL Database (Prisma) | ---> Saves to Events & updates Devices table
  +-------+---------------+-------+
          |               |
   4a. WS Broadcast       | 4b. Outbound Webhook Subscribers
          v               v
  +---------------+  +-----------------------------------+
  | Socket.IO     |  | Durable Webhook Delivery Queue    | ---> Retries with HMAC SHA-256
  | (Real-time)   |  | (PendingWebhookDeliveries)        |      & SSRF Protection
  +---------------+  +-----------------------------------+
```

---

## Core Components & How It Works

### 1. Ingestion Pipeline & ISAPI Parsing
* Physical Hikvision devices push events via HTTP `POST` requests to `/api/webhooks/hikvision` or `/api/webhooks/:source`.
* Payloads arrive as raw string XML, JSON, or `multipart/form-data` MIME boundaries containing `event_log` snapshots or XML blocks.
* `parseHikvisionEvent()` extracts vendor codes (`majorEventType`, `minorEventType`, `subEventType`, `currentVerifyMode`) and transforms them into a clean, vendor-neutral `NormalizedEvent` contract:
  * **Supported Event Types**: `CHECK_IN`, `CHECK_OUT`, `DOOR_OPEN`, `DOOR_CLOSED`, `DOOR_FORCED`, `MOTION`, `CAMERA_OFFLINE`, `HEARTBEAT`, `UNKNOWN`.
  * **Device Types**: `face_terminal`, `door_controller`, `camera`.

### 2. Clock Skew Bounds Policy
* Device timestamps are validated against the server clock to detect skewed hardware clocks.
* Depending on configuration (`CLOCK_SKEW_POLICY`), timestamps out of bounds are normalized to server time or safely rejected into `AuditLogs`.

### 3. Event Deduplication Engine
* Generates a deterministic deduplication key:
  `deviceId | eventType | timestampISO | employeeId`
* Enforced via a `@unique` constraint on `eventDedupKey` in PostgreSQL to safely ignore duplicate HTTP retries from hardware terminals.

### 4. Device Status Registry & Heartbeat Throttling
* Automatically registers unknown devices on arrival.
* Bumps `lastEventAt` and auto-heals device status from `OFFLINE` to `ONLINE`.
* `HEARTBEAT` events are throttled via `HeartbeatCounters` (persisted only once every 10 heartbeats) to prevent database bloat.

### 5. Outbound Webhook Subscriptions (Durable Queue)
* External applications (like external attendance engines, dashboards, or CRMs) can subscribe to events by registering HTTP endpoints via `POST /api/webhooks/subscriptions`.
* When an event is stored, matching subscriptions are enqueued in `PendingWebhookDeliveries`.
* **Security & Reliability**:
  * **HMAC SHA-256 Signatures**: Deliveries include a `X-Hub-Signature-256` header signed with the subscription's secret.
  * **SSRF Prevention**: Re-validates destination URLs at dispatch time to prevent internal network scanning or private IP access.
  * **Durable Retries**: Failed deliveries retry with exponential backoff (`2s`, `4s`, `8s`, `16s`, `32s`) up to 5 attempts.

---

## Complete API Reference

### Public / Device Webhooks

#### `POST /api/webhooks/hikvision` (or `/api/webhooks/:source`)
* **Auth**: Public (Device HTTP Push)
* **Content-Type**: `multipart/form-data`, `application/xml`, `application/json`
* **Response**: `200 OK` (`{"status": "received", "message": "Webhook payload accepted"}`)

#### `GET /health`
* **Auth**: Public
* **Response**: `200 OK` (`{"status": "OK", "service": "hikvision-event-receiver"}`)

#### `POST /api/auth/login`
* **Auth**: Public
* **Body**: `{"username": "admin", "password": "your-password"}`
* **Response**: `200 OK` (`{"token": "JWT_BEARER_TOKEN"}`)

---

### Protected Management Endpoints (Requires `Bearer JWT` or `X-API-Key`)

#### `GET /api/events`
* Query normalized events with filtering and pagination.
* **Query Parameters**:
  * `deviceId` (string) — Filter by device MAC/IP
  * `eventType` (string) — Filter by event type (`CHECK_IN`, `DOOR_OPEN`, etc.)
  * `employeeId` (string) — Filter by employee number
  * `startDate` & `endDate` (ISO strings) — Date range filter
  * `limit` (number, default: 50, max: 100)
  * `offset` (number, default: 0)
  * `cursor` (string) — Cursor UUID for next page

#### `GET /api/events/:id`
* Get full event detail by UUID.

#### `GET /api/devices`
* List all registered Hikvision terminals, their online statuses, firmware versions, and last seen timestamps.

#### `PATCH /api/devices/:id`
* Update device metadata (`name`, `type`, `status`, `firmwareVersion`).

#### `POST /api/webhooks/subscriptions`
* Register a new external webhook subscriber.
* **Body**:
  ```json
  {
    "url": "https://example.com/api/events-receiver",
    "eventTypes": ["CHECK_IN", "CHECK_OUT", "*"]
  }
  ```
* **Response**: `201 Created` with unique `webhookSecret` for HMAC signature validation.

#### `GET /api/webhooks/subscriptions`
* List active webhook subscriptions.

#### `DELETE /api/webhooks/subscriptions/:id`
* Delete a webhook subscription.

#### `POST /api/api-keys`
* Create a new API Key for programmatic system integration.

---

## Database Models

| Table | Purpose |
| :--- | :--- |
| `Events` | Stores normalized and raw event payloads with audit headers. |
| `Devices` | Device inventory, status (`ONLINE`/`OFFLINE`), and last active timestamp. |
| `WebhookSubscriptions` | Registered subscriber URLs, event filters, and HMAC secrets. |
| `PendingWebhookDeliveries` | Durable queue for outgoing webhooks with retry metadata. |
| `HeartbeatCounters` | Throttling counter for device heartbeat events. |
| `ApiKeys` | Programmatic API authentication keys (SHA-256 hashed). |
| `AuditLogs` | System logs for rejected events or security alerts. |

---

## Container Runtime

- **Engine**: Podman (`podman` / `podman-compose`)
- **Node Base Image**: `node:22-alpine`

