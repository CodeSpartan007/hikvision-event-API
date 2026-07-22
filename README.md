# Hikvision Event Receiver & Telemetry Service

A lightweight, high-performance microservice for receiving, parsing, storing, and relaying Hikvision access control and camera events in real time.

For full architectural details, ingestion flows, and internal mechanics, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Key Features
- **ISAPI Webhook Ingestion**: Receives XML, JSON, and multipart form-data streams pushed by Hikvision terminals & cameras.
- **Normalized Event Contract**: Standardizes raw payloads into a clean vendor-neutral schema (`CHECK_IN`, `CHECK_OUT`, `DOOR_OPEN`, `MOTION`, `HEARTBEAT`, etc.).
- **Event Deduplication**: Uses deterministic deduplication keys (`deviceId|eventType|timestamp|externalEmployeeId`) to prevent duplicate logs.
- **Clock Skew Management**: Normalizes or rejects out-of-bounds timestamps automatically.
- **Device Online Tracking**: Updates terminal status & auto-registers new devices on arrival.
- **Real-Time WebSocket**: Broadcasts events to client dashboards in real-time via Socket.IO.
- **Outbound Webhook Subscriptions**: Relays events asynchronously to external webhooks with HMAC SHA-256 signatures, SSRF protection, and exponential backoff retries.
- **Pruned Footprint**: Excludes attendance rules, employee database, notifications, and complex business logic for fast, low-overhead event processing.

## Getting Started

### Local Development
```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate --schema=./src/database/schema.prisma

# Build TypeScript code
npm run build

# Start dev server
npm run dev
```

### Docker
```bash
docker-compose up -d --build
```

## API Endpoint Quick Reference

### Public / Webhooks
- `POST /api/webhooks/hikvision` — Receives Hikvision ISAPI events
- `POST /api/webhooks/:source` — Generic webhook receiver
- `GET /health` — Service health check
- `POST /api/auth/login` — Authenticate admin

### Protected API (Requires Bearer JWT Token or API Key)
- `GET /api/events` — Query paginated events (supports `deviceId`, `eventType`, `externalEmployeeId`, `startDate`, `endDate`, `cursor`, `limit`, `offset`)
- `GET /api/events/:id` — Get single event by ID
- `GET /api/devices` — List all registered devices and online statuses
- `GET /api/devices/:id` — Get device details
- `PATCH /api/devices/:id` — Update device details
- `POST /api/webhooks/subscriptions` — Register an outbound webhook subscriber
- `GET /api/webhooks/subscriptions` — List active webhook subscribers
- `DELETE /api/webhooks/subscriptions/:id` — Remove a webhook subscriber
- `POST /api/api-keys` — Create API keys for programmatic access
