import dotenv from 'dotenv';
import { z } from 'zod';
import pino from 'pino';

// Load environment variables
dotenv.config();

const parseBooleanEnv = (value: unknown): unknown => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return value;
};

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  ENFORCE_HTTPS: z.preprocess(parseBooleanEnv, z.boolean().default(false)),
  TRUST_PROXY: z.preprocess(
    (val) => {
      if (val === undefined || val === '') return 1;
      if (val === true || val === 'true' || val === '1') return 1;
      if (val === false || val === 'false' || val === '0') return false;
      if (typeof val === 'string' && /^\d+$/.test(val.trim())) return Number(val);
      return val;
    },
    z.union([z.boolean(), z.number(), z.string()]).default(1)
  ),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(1000),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RAW_PAYLOAD_RETENTION_DAYS: z.preprocess(
    (val) => {
      if (val === undefined || val === '') return undefined;
      const input = String(val);
      if (!/^-?\d+$/.test(input)) return 90;
      return Number(input);
    },
    z.number().int().min(0).optional()
  ),
  TIMEZONE: z.string().default('UTC'),
  MAX_FUTURE_SKEW_SECONDS: z.coerce.number().default(300),
  MAX_PAST_SKEW_SECONDS: z.coerce.number().default(86400),
  CLOCK_SKEW_POLICY: z.enum(['normalize', 'reject', 'accept']).default('normalize'),
});

type EnvConfig = z.infer<typeof envSchema>;

let env: EnvConfig;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  const bootstrapLogger = pino({
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  });
  
  if (error instanceof z.ZodError) {
    bootstrapLogger.fatal(
      { errors: error.flatten().fieldErrors },
      'Invalid environment configuration'
    );
  } else {
    bootstrapLogger.fatal(error, 'Unknown error during environment validation');
  }
  process.exit(1);
}

if (env.NODE_ENV === 'production') {
  if (!env.JWT_SECRET || !env.ADMIN_PASSWORD) {
    const bootstrapLogger = pino();
    bootstrapLogger.fatal(
      'Missing required production secrets: JWT_SECRET and/or ADMIN_PASSWORD'
    );
    process.exit(1);
  }
} else {
  env.JWT_SECRET = env.JWT_SECRET || 'super-secret-dev-key';
  env.ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin123';
}

export { env };
