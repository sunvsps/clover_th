import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { EnvError } from '../../src/config/env.js';
import { CSRF, createTestApp, testEnv } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildApp } from '../../src/app.js';

// LOCAL_DEMO_ENABLED: the demo login exists only behind the flag, only for loopback peers, and never in production.
// The authz matrix (test/hardening/authz.test.ts) builds the app with the flag OFF, so these conditional routes are not
// in it by design; their guards are tested here instead.
let db: TestDb;
let app: Awaited<ReturnType<typeof createTestApp>>;
const registered: string[] = [];
const ON = { LOCAL_DEMO_ENABLED: 'true' };

beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma);
  await db.prisma.member.createMany({
    data: [
      { discordId: '6660001', ign: 'DemoAdmin', nickname: 'da', jobId: 1, isAdmin: true },
      { discordId: '6660002', ign: 'DemoMember', nickname: null, jobId: 1 },
      { discordId: '6660003', ign: 'DemoGone', nickname: 'g', jobId: 1, isActive: false },
    ],
  });
  const onRoute = (r: RouteOptions) => void registered.push(`${[r.method].flat().join(',')} ${r.url}`);
  app = await createTestApp(db, { env: ON, onRoute });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

const login = (discordId: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/demo/login', headers: CSRF, payload: { discordId }, ...extra });

describe('flag on', () => {
  it('registers exactly the two demo routes', () => {
    const demo = registered.filter((r) => r.includes('/demo/') && !r.startsWith('HEAD')).sort();
    expect(demo).toEqual(['GET /api/v1/demo/members', 'POST /api/v1/demo/login']);
  });

  it('lists the active members with id, discordId, ign, nickname and the admin flag from the DB, and nothing else', async () => {
    const res = await app.inject('/api/v1/demo/members');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list.map((m) => m.ign)).toContain('DemoAdmin');
    expect(list.map((m) => m.ign)).not.toContain('DemoGone'); // inactive members are not offered
    for (const m of list)
      expect(Object.keys(m).sort()).toEqual(['discordId', 'ign', 'isAdmin', 'memberId', 'nickname']);
    expect(list.find((m) => m.ign === 'DemoAdmin')).toMatchObject({ isAdmin: true, discordId: '6660001' });
    expect(list.find((m) => m.ign === 'DemoMember')).toMatchObject({ isAdmin: false });
  });

  it('login creates a normal session: /me shows the profile, isAdmin comes from the database, writes need the CSRF header', async () => {
    const res = await login('6660001');
    expect(res.statusCode).toBe(204);
    const set = res.headers['set-cookie'] as string;
    expect(set).toMatch(/^session=[\w-]{40,}/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Path=\//);
    expect(set).not.toMatch(/Secure/); // http on loopback
    const token = /^session=([^;]+)/.exec(set)![1]!;
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie: `session=${token}` } });
    expect(me.json()).toMatchObject({ discordId: '6660001', ign: 'DemoAdmin', isAdmin: true });
    const user = await login('6660002');
    const utoken = /^session=([^;]+)/.exec(user.headers['set-cookie'] as string)![1]!;
    expect(
      (await app.inject({ url: '/api/v1/me', headers: { cookie: `session=${utoken}` } })).json(),
    ).toMatchObject({ isAdmin: false });
    // stored like any session: only the hash, and about 8 hours
    const rows = await db.prisma.session.findMany({ where: { member: { discordId: '6660001' } } });
    expect(rows.every((r) => r.id !== token && /^[0-9a-f]{64}$/.test(r.id))).toBe(true);
    const hours = (rows.at(-1)!.expiresAt.getTime() - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(7.5);
    expect(hours).toBeLessThanOrEqual(8.01);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `session=${token}` },
    });
    expect(noCsrf.json().error.code).toBe('CSRF_REJECTED');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { cookie: `session=${token}`, ...CSRF },
        })
      ).statusCode,
    ).toBe(204);
  });

  it('writes an audit row (auth.demo_login) without the token', async () => {
    const res = await login('6660002');
    const token = /^session=([^;]+)/.exec(res.headers['set-cookie'] as string)![1]!;
    const rows = await db.prisma.auditLog.findMany({ where: { action: 'auth.demo_login' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('unknown and deactivated members get the same not-registered answer, and no session is created', async () => {
    const before = await db.prisma.session.count();
    for (const id of ['1234567', '6660003']) {
      const res = await login(id);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('AUTH_NOT_REGISTERED');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(await db.prisma.session.count()).toBe(before);
  });

  it('keeps CSRF and a strict body: no X-Requested-With, a foreign Origin, or extra fields are rejected', async () => {
    expect(
      (
        await app.inject({ method: 'POST', url: '/api/v1/demo/login', payload: { discordId: '6660002' } })
      ).json().error.code,
    ).toBe('CSRF_REJECTED');
    expect(
      (await login('6660002', { headers: { ...CSRF, origin: 'https://evil.example' } })).json().error.code,
    ).toBe('CSRF_REJECTED');
    const extra = await app.inject({
      method: 'POST',
      url: '/api/v1/demo/login',
      headers: CSRF,
      payload: { discordId: '6660001', isAdmin: true },
    });
    expect(extra.statusCode).toBe(422);
    expect((await login('not-a-number')).statusCode).toBe(422);
  });

  it('answers 404 to any peer that is not loopback, whatever X-Forwarded-For says', async () => {
    for (const remoteAddress of ['10.0.0.5', '192.168.1.20', '::ffff:10.1.1.1']) {
      const list = await app.inject({
        url: '/api/v1/demo/members',
        remoteAddress,
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });
      expect(list.statusCode, remoteAddress).toBe(404);
      const res = await login('6660001', {
        remoteAddress,
        headers: { ...CSRF, 'x-forwarded-for': '127.0.0.1' },
      });
      expect(res.statusCode, remoteAddress).toBe(404);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      expect(
        (await app.inject({ url: '/api/v1/demo/members', remoteAddress })).statusCode,
        remoteAddress,
      ).toBe(200);
  });

  it('is in the OpenAPI document only while enabled', async () => {
    const on = Object.keys((await app.inject('/docs/json')).json().paths);
    expect(on).toContain('/api/v1/demo/login');
  });
});

describe('flag off, and the startup guards', () => {
  it('off (the default): both routes are 404 and absent from the OpenAPI document', async () => {
    const off = await createTestApp(db);
    await off.ready();
    try {
      expect((await off.inject('/api/v1/demo/members')).statusCode).toBe(404);
      expect(
        (
          await off.inject({
            method: 'POST',
            url: '/api/v1/demo/login',
            headers: CSRF,
            payload: { discordId: '6660001' },
          })
        ).statusCode,
      ).toBe(404);
      const paths = Object.keys((await off.inject('/docs/json')).json().paths);
      expect(paths.some((p) => p.includes('/demo'))).toBe(false);
    } finally {
      await off.close();
    }
  });

  it('only the strings true and false are accepted', () => {
    for (const bad of ['1', 'yes', 'TRUE', 'True', 'on'])
      expect(() => testEnv(db, undefined, { LOCAL_DEMO_ENABLED: bad })).toThrow(EnvError);
    expect(testEnv(db, undefined, { LOCAL_DEMO_ENABLED: 'false' }).LOCAL_DEMO_ENABLED).toBe(false);
    expect(testEnv(db).LOCAL_DEMO_ENABLED).toBe(false);
  });

  it('production with the flag on refuses to start', () => {
    expect(() =>
      testEnv(db, undefined, {
        ...ON,
        NODE_ENV: 'production',
        SESSION_SECRET: 'Kq3vZ8xT1mR7wN5pL2yB9cD4fG6hJ0aSuEoIiXtVnMz',
      }),
    ).toThrow(/LOCAL_DEMO_ENABLED=true is for local demos only/);
  });

  it('a non-local database refuses to start, unless explicitly allowed (the dev-login rule)', async () => {
    const remote = testEnv(db, undefined, ON);
    const url = 'postgresql://u:p@db.prod.example.com:5432/x?connection_limit=5&pool_timeout=5';
    await expect(buildApp({ env: { ...remote, DATABASE_URL: url }, prisma: db.prisma })).rejects.toThrow(
      /not a local database/,
    );
    const allowed = await buildApp({
      env: { ...remote, DATABASE_URL: url, DEV_LOGIN_ALLOW_REMOTE_DB: '1' },
      prisma: db.prisma,
    });
    await allowed.ready();
    await allowed.close();
  });
});
