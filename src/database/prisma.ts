import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from '../config/env.js';

let currentPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

let currentAdapter = new PrismaPg(currentPool);
let currentPrisma = new PrismaClient({ adapter: currentAdapter });

export const pool = new Proxy({} as pg.Pool, {
  get(target, prop) {
    const value = Reflect.get(currentPool, prop);
    return typeof value === 'function' ? value.bind(currentPool) : value;
  }
});

export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop) {
    const value = Reflect.get(currentPrisma, prop);
    return typeof value === 'function' ? value.bind(currentPrisma) : value;
  }
});

export function setDatabaseUrl(url: string) {
  currentPool.end().catch(() => {
    // Ignore pool end errors
  });
  currentPool = new pg.Pool({
    connectionString: url,
  });
  currentAdapter = new PrismaPg(currentPool);
  currentPrisma = new PrismaClient({ adapter: currentAdapter });
}
