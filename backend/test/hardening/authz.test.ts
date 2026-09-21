import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { createTestApp, BOT_KEY, CSRF } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { startMockDiscord, type MockDiscord } from '../helpers/mockDiscord.js';
import { session } from '../auctions/helpers.js';
import { assertComplete } from '../authz/matrix.js';
import { routes } from '../authz/routes.js';

// AC-14: the matrix must cover every route, admin routes must be admin-only, and nothing may accept or grant isAdmin.
let db: TestDb;
let mock: MockDiscord;
let app: Awaited<ReturnType<typeof createTestApp>>;
const registered: { method: string; url: string }[] = [];

beforeAll(async () => {
  db = await createTestDb();
  mock = await startMockDiscord();
  await seed(db.prisma);
  const onRoute = (r: RouteOptions) => {
    for (const m of [r.method].flat())
      if (m !== 'HEAD' && m !== 'OPTIONS') registered.push({ method: m, url: r.url });
  };
  app = await createTestApp(db, { mock, onRoute });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await mock.close();
  await db.drop();
});

type Spec = {
  paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>>;
};

describe('authorization matrix (AC-14)', () => {
  it('a route missing from the matrix fails the check (and so does a matrix entry without a route)', () => {
    expect(() =>
      assertComplete([...registered, { method: 'GET', url: '/api/v1/new-secret-route' }], routes),
    ).toThrow();
    expect(() =>
      assertComplete(
        registered.filter((r) => r.url !== '/api/v1/me'),
        routes,
      ),
    ).toThrow();
    expect(() => assertComplete(registered, routes)).not.toThrow();
  });

  it('every route is classified by its path: /admin => admin, /bot => bot, the rest member or public', () => {
    const publicOnly = new Set([
      '/healthz',
      '/docs/json',
      '/api/v1/auth/discord/login',
      '/api/v1/auth/discord/callback',
    ]);
    for (const s of routes) {
      const plannerWrite = s.pattern.includes('/plan') && s.method !== 'GET'; // planner writes are admin-only
      if (s.pattern.startsWith('/api/v1/admin/') || plannerWrite) expect(s.auth, s.pattern).toBe('admin');
      else if (s.pattern.startsWith('/api/v1/bot/')) expect(s.auth, s.pattern).toBe('bot');
      else if (publicOnly.has(s.pattern)) expect(s.auth, s.pattern).toBe('public');
      else expect(s.auth, s.pattern).toBe('member');
    }
  });

  it('every admin route: AUTH_REQUIRED without a session, ADMIN_REQUIRED for a member, and the bot key does not open it', async () => {
    const member = await session(dbWorld(), { admin: false });
    for (const s of routes.filter((r) => r.auth === 'admin')) {
      const send = (headers: Record<string, string>) =>
        app.inject({ method: s.method, url: s.url, headers, ...(s.payload ? { payload: s.payload } : {}) });
      const anon = await send({});
      expect([anon.statusCode, anon.json().error.code], s.pattern).toEqual([401, 'AUTH_REQUIRED']);
      const asBot = await send({ 'x-bot-key': BOT_KEY });
      expect(asBot.json().error.code, s.pattern).toBe('AUTH_REQUIRED');
      const asMember = await send({ ...member.h });
      expect([asMember.statusCode, asMember.json().error.code], s.pattern).toEqual([403, 'ADMIN_REQUIRED']);
    }
  });

  it('the OpenAPI document has no isAdmin in any request body, and every JSON body is strict (additionalProperties: false)', async () => {
    const spec = (await app.inject('/docs/json')).json() as Spec;
    let bodies = 0;
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          expect(k.toLowerCase(), `${path}.${k}`).not.toBe('isadmin');
          walk(v, `${path}.${k}`);
        }
      }
    };
    for (const [p, ops] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(ops)) {
        const schema = op.requestBody?.content?.['application/json']?.schema as
          { type?: string; additionalProperties?: unknown } | undefined;
        if (!schema) continue;
        bodies++;
        walk(schema, `${m.toUpperCase()} ${p}`);
        if (schema.type === 'object')
          expect(schema.additionalProperties, `${m} ${p} must reject unknown fields`).toBe(false);
      }
    }
    expect(bodies).toBeGreaterThan(12);
  });

  it('no route accepts isAdmin: every body-taking route answers 422 VALIDATION_ERROR to an added isAdmin and creates no admin', async () => {
    const spec = (await app.inject('/docs/json')).json() as Spec;
    const admin = await session(dbWorld(), { admin: true });
    const before = await db.prisma.member.count({ where: { isAdmin: true } });
    let tried = 0;
    for (const s of routes) {
      const openapiPath = s.pattern.replace(/:(\w+)/g, '{$1}');
      const op = spec.paths[openapiPath]?.[s.method.toLowerCase()];
      if (!op?.requestBody) continue;
      const headers: Record<string, string> = s.auth === 'bot' ? { 'x-bot-key': BOT_KEY } : { ...admin.h };
      const res = await app.inject({
        method: s.method,
        url: s.url,
        headers,
        payload: { ...(s.payload ?? {}), isAdmin: true },
      });
      expect([res.statusCode, res.json().error?.code], `${s.method} ${s.pattern}`).toEqual([
        422,
        'VALIDATION_ERROR',
      ]);
      tried++;
    }
    expect(tried).toBeGreaterThan(12);
    expect(await db.prisma.member.count({ where: { isAdmin: true } })).toBe(before);
  });

  it('there is no route that grants admin (no path or operation mentions admin grants)', async () => {
    const spec = (await app.inject('/docs/json')).json() as Spec;
    for (const [p, ops] of Object.entries(spec.paths)) {
      expect(p.toLowerCase(), p).not.toMatch(/grant|promote|make-admin|set-admin/);
      void ops;
    }
  });

  it('cookie writes still need the CSRF header on every member/admin write route', async () => {
    const admin = await session(dbWorld(), { admin: true });
    const noCsrf = { cookie: admin.h.cookie! };
    for (const s of routes.filter((r) => r.auth !== 'public' && r.auth !== 'bot' && r.method !== 'GET')) {
      const res = await app.inject({
        method: s.method,
        url: s.url,
        headers: noCsrf,
        ...(s.payload ? { payload: s.payload } : {}),
      });
      expect([res.statusCode, res.json().error.code], `${s.method} ${s.pattern}`).toEqual([
        403,
        'CSRF_REJECTED',
      ]);
    }
    void CSRF;
  });
});

/** Tiny adapter so the shared session helper (which wants a World) can be used with this file's own DB. */
let counter = 9_000_000;
function dbWorld() {
  return {
    db,
    member: async (ign?: string, extra: Record<string, unknown> = {}) => {
      counter++;
      const m = await db.prisma.member.create({
        data: {
          discordId: String(counter),
          ign: ign ?? `hard-${counter}`,
          nickname: 'n',
          jobId: 2,
          ...extra,
        },
      });
      return { id: m.id, discordId: m.discordId, ign: m.ign };
    },
  } as never;
}
