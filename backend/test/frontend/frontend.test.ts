import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { createTestApp } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

const INDEX =
  '<!doctype html><html><head><title>Clover</title></head><body><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>';
const HTML = { accept: 'text/html,application/xhtml+xml' };

let db: TestDb;
let dist: string;
let app: Awaited<ReturnType<typeof createTestApp>>;
let queries = 0;

/** A logged-in member (the seeded admin) with a real session row; returns the Cookie header value. */
async function login(): Promise<string> {
  const m = await db.prisma.member.findFirstOrThrow({ where: { isAdmin: true } });
  const token = randomBytes(32).toString('base64url');
  const id = createHash('sha256').update(token).digest('hex');
  await db.prisma.$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt")
    VALUES (${id}, ${m.id}::uuid, clock_timestamp() + interval '1 day')`;
  return `session=${token}`;
}

beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma, { dev: true });
  dist = mkdtempSync(join(tmpdir(), 'clover-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
  writeFileSync(join(dist, 'assets', 'index-abc123.css'), 'body{margin:0}');
  app = await createTestApp(db, { env: { SERVE_FRONTEND: 'on', FRONTEND_DIST_DIR: dist } });
  // count every database query the app makes, to prove static requests never reach the database
  const raw = db.prisma.$queryRaw.bind(db.prisma) as (...a: unknown[]) => unknown;
  vi.spyOn(db.prisma, '$queryRaw').mockImplementation(((...a: unknown[]) => {
    queries += 1;
    return raw(...a);
  }) as never);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.drop();
  rmSync(dist, { recursive: true, force: true });
});

describe('serving the built frontend', () => {
  it('serves index.html at / with no-cache', async () => {
    const res = await app.inject({ url: '/', headers: HTML });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes and deep links (200, not 404)', async () => {
    for (const url of ['/some/route', '/teams', '/calendar/2026-09-22', '/#teams', '/?x=1#admin']) {
      const res = await app.inject({ url, headers: HTML });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<div id="root">');
      expect(res.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('a missing asset (with an extension) is a 404, never index.html', async () => {
    for (const url of ['/assets/missing.js', '/nope.png', '/assets/index-abc123.js.map']) {
      const res = await app.inject({ url, headers: HTML });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('<div id="root">');
    }
  });

  it('a request that does not ask for HTML gets the JSON 404 for unknown non-API paths', async () => {
    const res = await app.inject({ url: '/some/route', headers: { accept: 'application/json' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('unknown /api/* paths keep the standard JSON 404 envelope, even when the client asks for HTML', async () => {
    for (const url of ['/api/v1/nope', '/api/nope', '/api', '/api/v1/members/extra/segments']) {
      const res = await app.inject({ url, headers: HTML });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/application\/json/);
      expect(res.json().error.code, url).toBe('NOT_FOUND');
    }
  });

  it('POST to a client-side path is not turned into index.html', async () => {
    const res = await app.inject({ method: 'POST', url: '/some/route', headers: HTML });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('hashed assets are cached for a year and immutable; other files for an hour', async () => {
    const js = await app.inject('/assets/index-abc123.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject('/assets/index-abc123.css')).headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    const icon = await app.inject('/favicon.svg');
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['cache-control']).toBe('public, max-age=3600');
    const index = await app.inject('/index.html');
    expect(index.headers['cache-control']).toBe('no-cache');
  });

  it('keeps the helmet security headers on static responses', async () => {
    const res = await app.inject({ url: '/', headers: HTML });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('/healthz and the API are untouched', async () => {
    const health = await app.inject('/healthz');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', db: 'ok' });
    expect(health.headers['cache-control']).toBeUndefined();
    const me = await app.inject('/api/v1/me');
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('AUTH_REQUIRED');
    expect(me.headers['cache-control']).toBe('no-store');
    const docs = await app.inject('/docs/json');
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths).not.toHaveProperty('/'); // the static routes are not documented
  });

  it('OpenAPI has no static routes', async () => {
    const paths = Object.keys((await app.inject('/docs/json')).json().paths);
    expect(paths.every((p) => p.startsWith('/api/') || p === '/healthz')).toBe(true);
  });
});

describe('static requests stay out of auth, the database and the limiters', () => {
  it('never look up a session: no database query, even with a session cookie', async () => {
    const cookie = await login();
    const before = queries;
    for (const url of ['/', '/teams', '/assets/index-abc123.js', '/favicon.svg', '/assets/missing.js']) {
      await app.inject({ url, headers: { ...HTML, cookie } });
    }
    expect(queries - before).toBe(0);
    // ...while the same cookie still works on the API
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('a page-load burst of static requests trips no limiter, and does not spend the member budget', async () => {
    const limited = await createTestApp(db, {
      env: {
        SERVE_FRONTEND: 'on',
        FRONTEND_DIST_DIR: dist,
        PREAUTH_LIMIT_PER_MIN: '5',
        RATE_LIMIT_ANON_PER_MIN: '5',
        RATE_LIMIT_AUTH_PER_MIN: '5',
      },
    });
    await limited.ready();
    try {
      const cookie = await login();
      for (let i = 0; i < 40; i += 1) {
        const res = await limited.inject({
          url: i % 2 ? '/assets/index-abc123.js' : '/',
          headers: { ...HTML, cookie },
        });
        expect(res.statusCode).toBe(200);
      }
      // the API budget is intact: the first calls after the burst still succeed
      const me = await limited.inject({ url: '/api/v1/me', headers: { cookie } });
      expect(me.statusCode).toBe(200);
      // and the limiters still work on the API
      const codes: number[] = [];
      for (let i = 0; i < 12; i += 1)
        codes.push((await limited.inject({ url: '/api/v1/me', headers: { cookie } })).statusCode);
      expect(codes).toContain(429);
    } finally {
      await limited.close();
    }
  });

  it('does not create sessions or cookies', async () => {
    const res = await app.inject({ url: '/', headers: HTML });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('configuration', () => {
  it('without a built frontend the server still starts and serves the API only (auto)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'clover-empty-'));
    const api = await createTestApp(db, { env: { SERVE_FRONTEND: 'auto', FRONTEND_DIST_DIR: empty } });
    await api.ready();
    try {
      expect((await api.inject('/healthz')).statusCode).toBe(200);
      expect((await api.inject({ url: '/', headers: HTML })).statusCode).toBe(404);
      expect((await api.inject({ url: '/some/route', headers: HTML })).json().error.code).toBe('NOT_FOUND');
      expect((await api.inject('/api/v1/me')).statusCode).toBe(401);
    } finally {
      await api.close();
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('SERVE_FRONTEND=on refuses to start when there is nothing to serve; off never serves', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'clover-empty-'));
    await expect(
      createTestApp(db, { env: { SERVE_FRONTEND: 'on', FRONTEND_DIST_DIR: empty } }),
    ).rejects.toThrow(/index\.html does not exist/);
    const off = await createTestApp(db, { env: { SERVE_FRONTEND: 'off', FRONTEND_DIST_DIR: dist } });
    await off.ready();
    expect((await off.inject({ url: '/', headers: HTML })).statusCode).toBe(404);
    await off.close();
    rmSync(empty, { recursive: true, force: true });
  });
});
