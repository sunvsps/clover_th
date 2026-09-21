import type { Writable } from 'node:stream';
import type { RouteOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { hashBotKey } from '../../src/lib/botKey.js';
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_REDIRECT_URI, type MockDiscord } from './mockDiscord.js';
import type { TestDb } from './db.js';

export const BOT_KEY = 'test-bot-key-primary-000000000000';
export const BOT_KEY_2 = 'test-bot-key-secondary-0000000000';
export const FRONTEND = 'http://localhost:5173';
/** Headers a browser SPA would send on state-changing cookie requests. */
export const CSRF = { 'x-requested-with': 'clover-web', origin: FRONTEND };

export function testEnv(db: TestDb, mock?: MockDiscord, extra: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: db.url,
    SESSION_SECRET: 's'.repeat(40),
    DISCORD_CLIENT_ID: MOCK_CLIENT_ID,
    DISCORD_CLIENT_SECRET: MOCK_CLIENT_SECRET,
    DISCORD_REDIRECT_URI: MOCK_REDIRECT_URI,
    DISCORD_API_BASE: mock?.url ?? 'http://127.0.0.1:9',
    FRONTEND_URL: FRONTEND,
    BOT_API_KEYS: hashBotKey(BOT_KEY),
    // the default budgets are exercised by test/hardening; everywhere else they must not get in the way
    RATE_LIMIT_AUTH_PER_MIN: '1000000',
    RATE_LIMIT_ANON_PER_MIN: '1000000',
    BOT_KEY_FAILS_PER_MIN: '1000000',
    PREAUTH_LIMIT_PER_MIN: '10000000',
    ...extra,
  });
}

export async function createTestApp(
  db: TestDb,
  opts: {
    mock?: MockDiscord;
    env?: Record<string, string>;
    logStream?: Writable;
    onRoute?: (r: RouteOptions) => void;
  } = {},
) {
  const env = testEnv(db, opts.mock, opts.env);
  return buildApp({
    env,
    prisma: db.prisma,
    ...(opts.onRoute ? { onRoute: opts.onRoute } : {}),
    ...(opts.logStream ? { logStream: opts.logStream } : {}),
  });
}
