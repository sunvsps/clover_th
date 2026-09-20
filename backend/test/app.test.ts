import { execFileSync } from 'node:child_process';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EnvError, loadEnv } from '../src/config/env.js';
import { AppError } from '../src/lib/errors.js';
import { createTx } from '../src/lib/tx.js';
import { createTestApp } from './helpers/app.js';
import { createTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  db = await createTestDb();
  app = await createTestApp(db);
  // Test-only routes, registered before ready().
  app.get('/__t/boom', async () => {
    throw new AppError('X', 409, 'boom');
  });
  app
    .withTypeProvider()
    .post('/__t/valid', { schema: { body: z.object({ n: z.number() }).strict() } }, async () => ({
      ok: true,
    }));
  app.get('/__t/crash', async () => {
    throw new Error('secret internals');
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('WP1 scaffold', () => {
  it('GET /healthz returns 200 with the DB reachable', async () => {
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('unknown route returns the standard error JSON', async () => {
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it("thrown AppError('X', 409) returns {error:{code:'X'}}", async () => {
    const res = await app.inject('/__t/boom');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'X', message: 'boom' });
  });

  it('Zod validation failure returns VALIDATION_ERROR 422', async () => {
    const res = await app.inject({ method: 'POST', url: '/__t/valid', payload: { n: 'x', extra: 1 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('unexpected errors return INTERNAL_ERROR without leaking the message', async () => {
    const res = await app.inject('/__t/crash');
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret internals');
  });

  it('serves an OpenAPI document that includes /healthz', async () => {
    const res = await app.inject('/docs/json');
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toMatch(/^3\./);
    expect(Object.keys(res.json().paths)).toContain('/healthz');
  });

  it('sets and honours X-Request-Id', async () => {
    const a = await app.inject('/healthz');
    expect(a.headers['x-request-id']).toBeTruthy();
    const b = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'my-request-id-123' } });
    expect(b.headers['x-request-id']).toBe('my-request-id-123');
  });
});

describe('env validation', () => {
  it('missing required env fails with a clear message listing the variables', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    try {
      loadEnv({});
    } catch (e) {
      expect((e as Error).message).toContain('DATABASE_URL');
      expect((e as Error).message).toContain('SESSION_SECRET');
      expect((e as Error).message).toContain('BOT_API_KEYS');
    }
  });

  it('DATABASE_URL must carry connection_limit and pool_timeout', () => {
    const base = {
      SESSION_SECRET: 's'.repeat(32),
      DISCORD_CLIENT_ID: 'a',
      DISCORD_CLIENT_SECRET: 'b',
      DISCORD_REDIRECT_URI: 'http://x/cb',
      FRONTEND_URL: 'http://x',
      BOT_API_KEYS: 'a'.repeat(64),
    };
    expect(() => loadEnv({ ...base, DATABASE_URL: 'postgresql://u:p@h/db' })).toThrow(/connection_limit/);
    expect(() => loadEnv({ ...base, DATABASE_URL: 'postgresql://u:p@h/db?connection_limit=5' })).toThrow(
      /pool_timeout/,
    );
  });

  it('BOT_API_KEYS accepts at most two sha256 digests', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@h/db?connection_limit=5&pool_timeout=5',
      SESSION_SECRET: 's'.repeat(32),
      DISCORD_CLIENT_ID: 'a',
      DISCORD_CLIENT_SECRET: 'b',
      DISCORD_REDIRECT_URI: 'http://x/cb',
      FRONTEND_URL: 'http://x',
    };
    const d = 'a'.repeat(64);
    expect(loadEnv({ ...base, BOT_API_KEYS: `${d},${d}` }).BOT_API_KEYS).toHaveLength(2);
    expect(() => loadEnv({ ...base, BOT_API_KEYS: `${d},${d},${d}` })).toThrow();
    expect(() => loadEnv({ ...base, BOT_API_KEYS: 'not-a-digest' })).toThrow();
  });

  it('the server process exits non-zero with a clear message when env is missing', () => {
    let out = '';
    let code = 0;
    try {
      execFileSync('node_modules/.bin/tsx', ['src/server.ts'], {
        env: { PATH: process.env.PATH! },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { status: number; stderr: Buffer };
      code = err.status;
      out = err.stderr.toString();
    }
    expect(code).toBe(1);
    expect(out).toContain('Invalid environment configuration');
    expect(out).toContain('DATABASE_URL');
  });
});

describe('tx() helper', () => {
  it('applies maxWait and timeout from config', async () => {
    const $transaction = vi.fn(async (fn: (t: unknown) => unknown, _opts?: unknown) => fn({}));
    const tx = createTx({ $transaction } as unknown as PrismaClient, { maxWaitMs: 1234, timeoutMs: 567 });
    await tx(async () => 1);
    expect($transaction.mock.calls[0]![1]).toEqual({ maxWait: 1234, timeout: 567 });
  });

  it('a forced timeout maps to SERVICE_BUSY 503', async () => {
    const tx = createTx(db.prisma, { maxWaitMs: 2000, timeoutMs: 100 });
    await expect(tx((t) => t.$executeRaw`SELECT pg_sleep(1)`)).rejects.toMatchObject({
      code: 'SERVICE_BUSY',
      status: 503,
    });
  });

  const p2034 = () =>
    new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: 'x' });

  it('retries P2034 once, then succeeds', async () => {
    const $transaction = vi.fn().mockRejectedValueOnce(p2034()).mockResolvedValueOnce('ok');
    const tx = createTx({ $transaction } as unknown as PrismaClient, { maxWaitMs: 1, timeoutMs: 1 });
    await expect(tx(async () => 'x')).resolves.toBe('ok');
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry', async () => {
    const $transaction = vi.fn().mockRejectedValue(p2034());
    const tx = createTx({ $transaction } as unknown as PrismaClient, { maxWaitMs: 1, timeoutMs: 1 });
    await expect(tx(async () => 'x')).rejects.toMatchObject({ code: 'P2034' });
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('the error handler maps a leftover P2034 / P2028 to 503 SERVICE_BUSY', async () => {
    const a = await createTestApp(db);
    a.get('/__t/p2034', async () => {
      throw p2034();
    });
    await a.ready();
    const res = await a.inject('/__t/p2034');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_BUSY');
    await a.close();
  });
});
