import { Express, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Hikvision Event Receiver & Telemetry API',
    version: '1.0.0',
    description: `
Lightweight, high-performance microservice for receiving, parsing, storing, and relaying Hikvision access control and camera events in real time.

### Features
- **ISAPI Webhook Ingestion**: Receives XML, JSON, and multipart form-data streams pushed by Hikvision terminals & cameras.
- **Normalized Event Schema**: Standardizes raw payloads into a clean vendor-neutral schema (\`CHECK_IN\`, \`CHECK_OUT\`, \`DOOR_OPEN\`, \`MOTION\`, \`HEARTBEAT\`, etc.).
- **Event Deduplication & Filtering**: Prevents duplicate logs using deterministic deduplication keys.
- **Outbound Webhooks**: Relays events asynchronously to external webhooks with HMAC SHA-256 signatures.
- **Flexible Auth**: Supports JWT Bearer tokens for admin users and \`X-API-Key\` headers for programmatic clients.
    `,
    contact: {
      name: 'API Support',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Current Server Environment',
    },
  ],
  tags: [
    { name: 'Health', description: 'System health check and diagnostic status' },
    { name: 'Auth', description: 'Authentication and token generation' },
    { name: 'Events', description: 'Query and retrieve access control and telemetry events' },
    { name: 'Devices', description: 'Manage access control terminals and IP cameras' },
    { name: 'Webhooks Ingestion', description: 'Endpoints receiving incoming telemetry from devices' },
    { name: 'Outbound Subscriptions', description: 'Manage outbound event push notifications and webhooks' },
    { name: 'API Keys', description: 'Manage API keys for programmatic integration' },
    { name: 'Audit Logs', description: 'Track system administrative and operational actions' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your Bearer JWT token obtained from `/api/auth/login`.',
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Enter your X-API-Key token created via `/api/api-keys`.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Bad Request' },
          message: { type: 'string', example: 'Invalid parameter provided' },
        },
        required: ['error', 'message'],
      },
      LoginRequest: {
        type: 'object',
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', example: 'supersecretpassword' },
        },
        required: ['username', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
        },
        required: ['token'],
      },
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'DEV-100293' },
          name: { type: 'string', example: 'Main Entrance Turnstile' },
          type: {
            type: 'string',
            enum: ['camera', 'face_terminal', 'door_controller'],
            example: 'face_terminal',
          },
          status: {
            type: 'string',
            enum: ['ONLINE', 'OFFLINE'],
            example: 'ONLINE',
          },
          firmwareVersion: { type: 'string', example: 'V4.22.000_210915' },
          lastEventAt: { type: 'string', format: 'date-time', nullable: true, example: '2026-07-22T10:00:00.000Z' },
        },
        required: ['id', 'name', 'type', 'status', 'firmwareVersion'],
      },
      CreateDeviceRequest: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'DEV-100293' },
          name: { type: 'string', example: 'Main Entrance Turnstile' },
          type: {
            type: 'string',
            enum: ['camera', 'face_terminal', 'door_controller'],
            example: 'face_terminal',
          },
          status: {
            type: 'string',
            enum: ['ONLINE', 'OFFLINE'],
            default: 'ONLINE',
            example: 'ONLINE',
          },
          firmwareVersion: { type: 'string', example: 'V4.22.000_210915' },
        },
        required: ['id', 'name', 'type'],
      },
      UpdateDeviceRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Updated Entrance Gate' },
          type: {
            type: 'string',
            enum: ['camera', 'face_terminal', 'door_controller'],
            example: 'door_controller',
          },
          status: {
            type: 'string',
            enum: ['ONLINE', 'OFFLINE'],
            example: 'OFFLINE',
          },
          firmwareVersion: { type: 'string', example: 'V4.25.001_220101' },
        },
      },
      Event: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'cld8x91230000yy0812345678' },
          source: { type: 'string', example: 'hikvision' },
          deviceId: { type: 'string', example: 'DEV-100293' },
          eventType: {
            type: 'string',
            enum: [
              'CHECK_IN',
              'CHECK_OUT',
              'DOOR_OPEN',
              'DOOR_CLOSED',
              'DOOR_FORCED',
              'MOTION',
              'CAMERA_OFFLINE',
              'HEARTBEAT',
              'UNKNOWN',
            ],
            example: 'CHECK_IN',
          },
          employeeId: { type: 'string', nullable: true, example: 'EMP-8842' },
          employeeName: { type: 'string', nullable: true, example: 'Cavin Juma' },
          eventDedupKey: { type: 'string', example: 'DEV-100293|CHECK_IN|1784713200000|EMP-8842' },
          rawPayload: { type: 'object', nullable: true },
          auditMetadata: { type: 'object', nullable: true },
          timestamp: { type: 'string', format: 'date-time', example: '2026-07-22T10:00:00.000Z' },
          createdAt: { type: 'string', format: 'date-time', example: '2026-07-22T10:00:01.000Z' },
        },
        required: ['id', 'source', 'deviceId', 'eventType', 'eventDedupKey', 'timestamp', 'createdAt'],
      },
      EventListResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Event' },
          },
          total: { type: 'integer', example: 150 },
          limit: { type: 'integer', example: 50 },
          offset: { type: 'integer', example: 0 },
          cursor: { type: 'string', nullable: true, example: 'cld8x91230000yy0812345678' },
        },
      },
      WebhookSubscription: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-1234567890ab' },
          url: { type: 'string', example: 'https://example.com/api/webhooks/listener' },
          eventTypes: {
            type: 'array',
            items: { type: 'string' },
            example: ['CHECK_IN', 'CHECK_OUT', 'DOOR_OPEN'],
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time', example: '2026-07-22T08:00:00.000Z' },
          updatedAt: { type: 'string', format: 'date-time', example: '2026-07-22T08:00:00.000Z' },
        },
        required: ['id', 'url', 'eventTypes', 'isActive', 'createdAt', 'updatedAt'],
      },
      CreateWebhookSubscriptionRequest: {
        type: 'object',
        properties: {
          url: { type: 'string', example: 'https://example.com/api/webhooks/listener' },
          eventTypes: {
            type: 'array',
            items: { type: 'string' },
            example: ['CHECK_IN', 'CHECK_OUT', '*'],
          },
        },
        required: ['url', 'eventTypes'],
      },
      CreateWebhookSubscriptionResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Webhook subscription registered successfully' },
          subscriptionId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-1234567890ab' },
          url: { type: 'string', example: 'https://example.com/api/webhooks/listener' },
          eventTypes: { type: 'array', items: { type: 'string' } },
          webhookSecret: { type: 'string', example: 'whsec_a8f9b2c3d4e5f678901234567890abcd' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      UpdateWebhookSubscriptionRequest: {
        type: 'object',
        properties: {
          url: { type: 'string', example: 'https://example.com/api/webhooks/updated-listener' },
          eventTypes: {
            type: 'array',
            items: { type: 'string' },
            example: ['CHECK_IN', 'DOOR_FORCED'],
          },
          isActive: { type: 'boolean', example: false },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d4e5' },
          name: { type: 'string', example: 'Integration Service Key' },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time', example: '2026-07-22T08:00:00.000Z' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true, example: '2027-07-22T08:00:00.000Z' },
        },
        required: ['id', 'name', 'isActive', 'createdAt'],
      },
      CreateApiKeyRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Integration Service Key' },
          expiresAt: { type: 'string', format: 'date-time', example: '2027-07-22T08:00:00.000Z' },
        },
        required: ['name'],
      },
      CreateApiKeyResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'API Key created successfully. Store this key securely; it will not be shown again!',
          },
          id: { type: 'string', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d4e5' },
          name: { type: 'string', example: 'Integration Service Key' },
          apiKey: { type: 'string', example: 'sep_live_a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      UpdateApiKeyRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Updated Key Name' },
          isActive: { type: 'boolean', example: false },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'e3b0c442-98fc-11ee-b9d1-0242ac120002' },
          action: { type: 'string', example: 'API_KEY_CREATED' },
          actorType: { type: 'string', example: 'ADMIN' },
          details: { type: 'string', example: 'Created API key Integration Service Key' },
          createdAt: { type: 'string', format: 'date-time', example: '2026-07-22T08:00:00.000Z' },
        },
        required: ['id', 'action', 'actorType', 'details', 'createdAt'],
      },
      AuditLogListResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/AuditLog' },
          },
          pagination: {
            type: 'object',
            properties: {
              total: { type: 'integer', example: 42 },
              limit: { type: 'integer', example: 50 },
              offset: { type: 'integer', example: 0 },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        description: 'Returns status and service identification.',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'OK' },
                    service: { type: 'string', example: 'hikvision-event-receiver' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Admin authentication',
        description: 'Authenticates admin credentials and returns a JWT Bearer token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authentication successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
          '401': {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/webhooks/hikvision': {
      post: {
        tags: ['Webhooks Ingestion'],
        summary: 'Receive Hikvision ISAPI event',
        description: 'Ingests raw XML, JSON, or multipart form-data pushed from Hikvision access control devices and cameras.',
        requestBody: {
          content: {
            'application/xml': {
              schema: {
                type: 'string',
                example: '<EventNotificationAlert version="2.0"><eventType>AccessControl</eventType></EventNotificationAlert>',
              },
            },
            'application/json': {
              schema: { type: 'object' },
            },
            'multipart/form-data': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook payload accepted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'received' },
                    message: { type: 'string', example: 'Webhook payload accepted' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/webhooks/{source}': {
      post: {
        tags: ['Webhooks Ingestion'],
        summary: 'Generic webhook receiver',
        description: 'Ingests webhook events from registered vendor sources.',
        parameters: [
          {
            name: 'source',
            in: 'path',
            required: true,
            description: 'Vendor parser identifier (e.g., `hikvision`)',
            schema: { type: 'string', example: 'hikvision' },
          },
        ],
        requestBody: {
          content: {
            'application/json': { schema: { type: 'object' } },
            'application/xml': { schema: { type: 'string' } },
          },
        },
        responses: {
          '200': {
            description: 'Webhook payload accepted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'received' },
                    message: { type: 'string', example: 'Webhook payload accepted' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Unregistered source/vendor',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/events': {
      get: {
        tags: ['Events'],
        summary: 'Get paginated events',
        description: 'Retrieves access control and telemetry events filtered by device, event type, employee ID, and time range.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of items to return (1-100, default 50)',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Number of items to skip',
            schema: { type: 'integer', default: 0 },
          },
          {
            name: 'cursor',
            in: 'query',
            description: 'Event ID cursor for pagination',
            schema: { type: 'string' },
          },
          {
            name: 'deviceId',
            in: 'query',
            description: 'Filter events by device ID',
            schema: { type: 'string' },
          },
          {
            name: 'eventType',
            in: 'query',
            description: 'Filter events by normalized event type',
            schema: {
              type: 'string',
              enum: [
                'CHECK_IN',
                'CHECK_OUT',
                'DOOR_OPEN',
                'DOOR_CLOSED',
                'DOOR_FORCED',
                'MOTION',
                'CAMERA_OFFLINE',
                'HEARTBEAT',
                'UNKNOWN',
              ],
            },
          },
          {
            name: 'employeeId',
            in: 'query',
            description: 'Filter events by employee ID',
            schema: { type: 'string' },
          },
          {
            name: 'employeeName',
            in: 'query',
            description: 'Filter events by employee name',
            schema: { type: 'string' },
          },
          {
            name: 'startDate',
            in: 'query',
            description: 'Filter events on or after this ISO date-time',
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'endDate',
            in: 'query',
            description: 'Filter events on or before this ISO date-time',
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: {
          '200': {
            description: 'List of events',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventListResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid parameter input',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/events/{id}': {
      get: {
        tags: ['Events'],
        summary: 'Get event by ID',
        description: 'Retrieves detailed record for a specific event.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Event ID',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Event record',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Event' },
              },
            },
          },
          '404': {
            description: 'Event not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/devices': {
      get: {
        tags: ['Devices'],
        summary: 'List devices',
        description: 'Returns all registered terminals, door controllers, and cameras.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Filter by device status',
            schema: { type: 'string', enum: ['ONLINE', 'OFFLINE'] },
          },
          {
            name: 'type',
            in: 'query',
            description: 'Filter by device type',
            schema: { type: 'string', enum: ['camera', 'face_terminal', 'door_controller'] },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer' },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer' },
          },
        ],
        responses: {
          '200': {
            description: 'List of devices',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Device' },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Devices'],
        summary: 'Register new device',
        description: 'Manually registers a new Hikvision hardware device.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDeviceRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Device created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Device' },
              },
            },
          },
          '409': {
            description: 'Device already exists',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/devices/{id}': {
      get: {
        tags: ['Devices'],
        summary: 'Get device by ID',
        description: 'Retrieves device details by ID.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Device details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Device' },
              },
            },
          },
          '404': {
            description: 'Device not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Devices'],
        summary: 'Update device',
        description: 'Updates device metadata (name, type, status, firmwareVersion).',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateDeviceRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Device updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Device' },
              },
            },
          },
          '404': {
            description: 'Device not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Devices'],
        summary: 'Delete device',
        description: 'Removes a registered device from the system.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Device deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Device DEV-100293 deleted successfully' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Device not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/webhooks/subscriptions': {
      get: {
        tags: ['Outbound Subscriptions'],
        summary: 'List webhook subscriptions',
        description: 'Retrieves all registered outbound webhook subscription targets.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'List of webhook subscriptions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/WebhookSubscription' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Outbound Subscriptions'],
        summary: 'Create webhook subscription',
        description: 'Registers an outbound URL to receive event notifications via HTTP POST (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateWebhookSubscriptionRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Subscription created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateWebhookSubscriptionResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid input or unsafe webhook target URL (SSRF protection)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/webhooks/subscriptions/{id}': {
      get: {
        tags: ['Outbound Subscriptions'],
        summary: 'Get subscription by ID',
        description: 'Retrieves details for a specific webhook subscription.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Subscription details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookSubscription' },
              },
            },
          },
          '404': {
            description: 'Subscription not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Outbound Subscriptions'],
        summary: 'Update webhook subscription',
        description: 'Updates target URL, event filters, or active status (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateWebhookSubscriptionRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Subscription updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookSubscription' },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Subscription not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Outbound Subscriptions'],
        summary: 'Delete webhook subscription',
        description: 'Deletes an outbound webhook subscription (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Subscription deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Subscription removed successfully' },
                  },
                },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Subscription not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys',
        description: 'Retrieves all generated API keys (without raw key hashes).',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'List of API keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ApiKey' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create API key',
        description: 'Generates a new X-API-Key token for programmatic API access (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateApiKeyRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'API key created successfully. Store key securely; it is shown only once.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateApiKeyResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/api-keys/{id}': {
      get: {
        tags: ['API Keys'],
        summary: 'Get API key by ID',
        description: 'Retrieves metadata for a specific API key.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'API key details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiKey' },
              },
            },
          },
          '404': {
            description: 'API key not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['API Keys'],
        summary: 'Update API key',
        description: 'Updates API key name, active status, or expiration date (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateApiKeyRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'API key updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiKey' },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'API key not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['API Keys'],
        summary: 'Delete API key',
        description: 'Deletes an API key (Admin JWT required).',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'API key deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'API Key deleted successfully' },
                  },
                },
              },
            },
          },
          '403': {
            description: 'Forbidden - Admin JWT required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'API key not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/audit-logs': {
      get: {
        tags: ['Audit Logs'],
        summary: 'Get paginated audit logs',
        description: 'Retrieves audit log history filtered by action or actor type.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'action',
            in: 'query',
            description: 'Filter by audit action',
            schema: { type: 'string' },
          },
          {
            name: 'actorType',
            in: 'query',
            description: 'Filter by actor type (e.g. `ADMIN`, `API_KEY`)',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of logs to retrieve (1-100, default 50)',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            description: 'Offset for pagination',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated audit logs',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuditLogListResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/audit-logs/{id}': {
      get: {
        tags: ['Audit Logs'],
        summary: 'Get audit log by ID',
        description: 'Retrieves a single audit log entry.',
        security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Audit log record',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuditLog' },
              },
            },
          },
          '404': {
            description: 'Audit log entry not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
};

export function setupSwagger(app: Express): void {
  const customOptions: swaggerUi.SwaggerUiOptions = {
    customSiteTitle: 'Hikvision Event API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
    },
  };

  app.get('/api-docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, customOptions));
}

export { swaggerUi };
export default setupSwagger;
