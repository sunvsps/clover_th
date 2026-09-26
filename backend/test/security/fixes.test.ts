import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { EnvError, loadEnv } from '../../src/config/env.js';
import { assertDevLoginAllowed, DevLoginRefused } from '../../src/lib/devLogin.js';
import { purgeExpiredSessions } from '../../src/lib/sessions.js';
import { createSweeper } from '../../src/modules/auctions/sweeper.js';
import { joinQueue } from '../../src/modules/auctions/queue.js';
import { BOT_KEY, createTestApp, FRONTEND } from '../helpers/app.js';
import { createTestDb, truncateAll, type TestDb } from '../helpers/db.js';
import type { World } from '../helpers/world.js';
import { startMockDiscord, type MockDiscord } from '../helpers/mockDiscord.js';
import { loginAs } from '../helpers/auth.js';
import {
  api,
  joinInOrder,
  openQueueRound,
  queueApi,
  queueOrder,
  session,
  sessions,
  setWindow,
} from '../auctions/helpers.js';

const run = promisify(execFile);
const PROD_SECRET = 'Zk3vQ8mWn1Rt6YpLc0XbJd7HsGf2AeUo9iVxNq4TwK5yBz';
let db: TestDb;
let mock: MockDiscord;
beforeAll(async () => {
  db = await createTestDb();
  mock = await startMockDiscord();
});
afterAll(async () => {
  await mock.close();
  await db.drop();
});
beforeAll(async () => {
  await seed(db.prisma);
});

/** Adapter so the shared helpers (built for a World) work with this file's DB. */
let counter = 4_000_000;
const world = () =>
  ({
    get db() {
      return db; // resolved lazily: the database is created in beforeAll
    },
    member: async (ign?: string, extra: Record<string, unknown> = {}) => {
      counter++;
      const m = await db.prisma.member.create({
        data: { discordId: String(counter), ign: ign ?? `sec-${counter}`, nickname: 'n', jobId: 2, ...extra },
      });
      return { id: m.id, discordId: m.discordId, ign: m.ign };
    },
    app: undefined as never,
  }) as unknown as World;
const w = world();
const withApp = (app: unknown) => ({ ...world(), app }) as unknown as World;

const appWith = async (
  env: Record<string, string> = {},
  setup?: (a: Awaited<ReturnType<typeof createTestApp>>) => void,
) => {
  const app = await createTestApp(db, { mock, env });
  setup?.(app);
  await app.ready();
  return app;
};
const ipRoute = (a: Awaited<ReturnType<typeof createTestApp>>) =>
  a.get('/__t/ip', async (req) => ({ ip: req.ip }));

describe('H-1 the real bot cannot be locked out', () => {
  it('a spoofed X-Forwarded-For carrying the bot address cannot lock the bot out', async () => {
    const app = await appWith({ BOT_KEY_FAILS_PER_MIN: '3' });
    const put = (headers: Record<string, string>, remoteAddress: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/bot/members/8100001',
        headers,
        remoteAddress,
        payload: { ign: 'BotLock', job: 'Knight' },
      });
    for (let i = 0; i < 6; i++)
      await put({ 'x-bot-key': 'wrong', 'x-forwarded-for': '198.51.100.7' }, '203.0.113.9');
    expect((await put({ 'x-bot-key': BOT_KEY }, '198.51.100.7')).statusCode).toBe(201);
    expect((await put({ 'x-bot-key': BOT_KEY }, '203.0.113.9')).statusCode).toBe(200);
    await app.close();
  });
});

describe('H-2 trusted proxy configuration', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@h/db?connection_limit=5&pool_timeout=5',
    SESSION_SECRET: 's'.repeat(40),
    DISCORD_CLIENT_ID: 'a',
    DISCORD_CLIENT_SECRET: 'b',
    DISCORD_REDIRECT_URI: 'http://x/cb',
    FRONTEND_URL: 'http://x',
    BOT_API_KEYS: 'a'.repeat(64),
  };

  it('the old TRUST_PROXY=true is refused at startup with a clear message; hops default to 0', () => {
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'false' })).not.toThrow();
    expect(loadEnv(base)).toMatchObject({ TRUST_PROXY_HOPS: 0, TRUST_PROXY_CIDRS: [] });
    expect(loadEnv({ ...base, TRUST_PROXY_CIDRS: '10.0.0.0/8, ::1' }).TRUST_PROXY_CIDRS).toEqual([
      '10.0.0.0/8',
      '::1',
    ]);
    expect(() => loadEnv({ ...base, TRUST_PROXY_CIDRS: 'not-an-ip' })).toThrow(EnvError);
    expect(() => loadEnv({ ...base, TRUST_PROXY_HOPS: '9' })).toThrow(EnvError);
  });

  it('default (no proxy): X-Forwarded-For is ignored, so rotating it does not defeat the per-IP limit', async () => {
    const app = await appWith({ RATE_LIMIT_ANON_PER_MIN: '5' });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (await app.inject({ url: '/docs/json', headers: { 'x-forwarded-for': `198.51.100.${i}` } }))
          .statusCode,
      );
    }
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    await app.close();
  });

  it('TRUST_PROXY_HOPS=1: the client is the address the proxy appended; a forged leftmost entry changes nothing', async () => {
    const app = await appWith({ TRUST_PROXY_HOPS: '1', RATE_LIMIT_ANON_PER_MIN: '5' }, ipRoute);
    const ip = async (xff: string) =>
      (
        await app.inject({ url: '/__t/ip', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': xff } })
      ).json().ip;
    expect(await ip('6.6.6.6, 9.9.9.9')).toBe('9.9.9.9'); // client forged 6.6.6.6, the proxy appended the real address
    expect(await ip('9.9.9.9')).toBe('9.9.9.9');
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (
          await app.inject({
            url: '/docs/json',
            remoteAddress: '10.0.0.1',
            headers: { 'x-forwarded-for': `1.2.3.${i}, 9.9.9.9` },
          })
        ).statusCode,
      );
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0); // the rotating leftmost value did not help
    // a different real client has its own budget
    expect(
      (
        await app.inject({
          url: '/docs/json',
          remoteAddress: '10.0.0.1',
          headers: { 'x-forwarded-for': '8.8.8.8' },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('TRUST_PROXY_CIDRS: only listed proxies are believed', async () => {
    const app = await appWith({ TRUST_PROXY_CIDRS: '10.0.0.0/8' }, ipRoute);
    const ip = async (remoteAddress: string, xff: string) =>
      (await app.inject({ url: '/__t/ip', remoteAddress, headers: { 'x-forwarded-for': xff } })).json().ip;
    expect(await ip('10.1.2.3', '5.5.5.5')).toBe('5.5.5.5'); // trusted proxy: believe its header
    expect(await ip('203.0.113.5', '5.5.5.5')).toBe('203.0.113.5'); // not a trusted proxy: header ignored
    await app.close();
  });
});

describe('H-3 a failing allocation never breaks reads', () => {
  it('lazy finalize errors are isolated: GETs keep working, no partial state, and the round is finalized once the fault is gone', async () => {
    await truncateAll(db.prisma);
    await seed(db.prisma);
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const Q = queueApi(wd);
    const admin = await session(wd, { admin: true });
    const [a, b] = await sessions(wd, 2);
    await joinInOrder(wd, [a!, b!], 'GEAR');
    const r = await openQueueRound(wd, admin, [
      { name: 'G1', category: 'GEAR' },
      { name: 'G2', category: 'GEAR' },
    ]);
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await setWindow(wd, r.id, '-10 seconds', '-1 second'); // the window is over, allocation is due
    // fault: a stale snapshot row makes allocation hit a unique violation
    await db.prisma.roundQueueSnapshot.create({
      data: { roundId: r.id, category: 'GEAR', memberId: a!.id, position: 1 },
    });

    for (const res of [await A.get(b!.h, r.id), await A.list(b!.h), await A.mine(b!.h, r.id)])
      expect(res.statusCode).toBe(200);
    expect((await A.get(b!.h, r.id)).json().status).toBe('OPEN'); // could not be finalized, still served
    expect((await A.results(b!.h, r.id)).json().error.code).toBe('ROUND_NOT_CLOSED');
    const sweeper = createSweeper({ prisma: db.prisma, tx: app.tx });
    await expect(sweeper.tick()).resolves.toBe(0); // the sweeper logs and skips, it does not throw
    // no partial state was left behind by the failed attempts
    const round = await db.prisma.auctionRound.findUniqueOrThrow({ where: { id: r.id } });
    expect(round).toMatchObject({ status: 'OPEN', allocatedAt: null });
    expect(await db.prisma.auctionItem.count({ where: { roundId: r.id, winnerId: { not: null } } })).toBe(0);
    expect(await db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } })).toBe(0);
    expect(await queueOrder(wd, 'GEAR')).toEqual([a!.id, b!.id]);
    expect(await db.prisma.auditLog.count({ where: { action: 'auction.allocation' } })).toBe(0);
    // fault fixed: the next sweep finalizes it correctly
    await db.prisma.roundQueueSnapshot.deleteMany({ where: { roundId: r.id } });
    expect(await sweeper.tick()).toBe(1);
    expect((await A.results(b!.h, r.id)).json().items[0].winner.memberId).toBe(a!.id);
    expect(await queueOrder(wd, 'GEAR')).toEqual([b!.id]); // winner A left the queue
    await app.close();
  });
});

describe('M-1 pre-auth budget and negative session cache', () => {
  it('garbage cookies and unknown routes are counted per IP before any database lookup', async () => {
    const app = await appWith({ PREAUTH_LIMIT_PER_MIN: '20' });
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      codes.push(
        (
          await app.inject({
            url: '/api/v1/me',
            headers: { cookie: `session=garbage-${i}-${'x'.repeat(30)}` },
          })
        ).statusCode,
      );
    }
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
    expect((await app.inject('/nope')).statusCode).toBe(429);
    expect((await app.inject('/healthz')).statusCode).toBe(200); // exempt
    await app.close();
    const flood = await appWith({ PREAUTH_LIMIT_PER_MIN: '5' });
    const not = [];
    for (let i = 0; i < 10; i++) not.push((await flood.inject(`/no-such-${i}`)).statusCode);
    expect(not.slice(5).every((c) => c === 429)).toBe(true);
    await flood.close();
  });

  it('the same unknown cookie costs the database only once; a real session is unaffected and normal traffic passes', async () => {
    const app = await appWith({ PREAUTH_LIMIT_PER_MIN: '1000' });
    const spy = vi.spyOn(db.prisma, '$queryRaw');
    for (let i = 0; i < 30; i++)
      await app.inject({
        url: '/api/v1/me',
        headers: { cookie: 'session=always-the-same-garbage-token-value' },
      });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
    const me = await session(w, {});
    for (let i = 0; i < 60; i++)
      expect((await app.inject({ url: '/api/v1/me', headers: me.h })).statusCode).toBe(200);
    await app.close();
  });
});

describe('M-2 the polling ETag reflects every edit', () => {
  it('draft name, cap, timing, item names/images and same-size item replacement all change the ETag; no edit keeps it', async () => {
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const admin = await session(wd, { admin: true });
    const created = (
      await A.create(admin.h, {
        type: 'LIVE_CLAIM',
        name: 'Draft',
        items: [
          { name: 'A', category: 'GEAR' },
          { name: 'B', category: 'CARD' },
        ],
      })
    ).json();
    const etagOf = async () => (await A.get(admin.h, created.id)).headers.etag as string;
    let etag = await etagOf();
    expect((await A.get(admin.h, created.id, { 'if-none-match': etag })).statusCode).toBe(304);
    const edits: object[] = [
      { name: 'Renamed' },
      { winCap: 2 },
      { durationSec: 90 },
      { startDelaySec: 9 },
      {
        items: [
          { name: 'A', category: 'GEAR' },
          { name: 'C', category: 'CARD' },
        ],
      }, // same count, one name changed
      {
        items: [
          { name: 'A', category: 'GEAR', rarity: 'Rare' },
          { name: 'C', category: 'CARD' },
        ],
      },
      {
        items: [
          { name: 'A', category: 'GEAR', rarity: 'Rare', imageUrl: 'https://example.com/x.png' },
          { name: 'C', category: 'CARD' },
        ],
      },
      {
        items: [
          { name: 'A', category: 'RELIC', rarity: 'Rare', imageUrl: 'https://example.com/x.png' },
          { name: 'C', category: 'CARD' },
        ],
      },
    ];
    for (const edit of edits) {
      expect((await A.patch(admin.h, created.id, edit)).statusCode, JSON.stringify(edit)).toBe(200);
      const stale = await A.get(admin.h, created.id, { 'if-none-match': etag });
      expect(stale.statusCode, `${JSON.stringify(edit)} must not answer 304`).toBe(200);
      const next = stale.headers.etag as string;
      expect(next).not.toBe(etag);
      expect((await A.get(admin.h, created.id, { 'if-none-match': next })).statusCode).toBe(304);
      etag = next;
    }
    await app.close();
  });
});

describe('M-3 deactivation and queues', () => {
  it('deactivation racing an allocation never leaves an inactive member in a queue', async () => {
    await truncateAll(db.prisma);
    await seed(db.prisma);
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const Q = queueApi(wd);
    const admin = await session(wd, { admin: true });
    for (let round = 0; round < 6; round++) {
      const [win, leaver, other] = await sessions(wd, 3, `M3r${round}x`);
      await db.prisma.queueEntry.deleteMany();
      await joinInOrder(wd, [win!, leaver!, other!], 'GEAR');
      const r = await openQueueRound(wd, admin, [
        { name: 'G1', category: 'GEAR' },
        { name: 'G2', category: 'GEAR' },
      ]);
      await Q.setPrefs(leaver!.h, r.id, [r.itemIds[0]!]);
      await Q.setPrefs(win!.h, r.id, [r.itemIds[1]!]);
      await Promise.all([
        A.close(admin.h, r.id),
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/members/${leaver!.id}/deactivate`,
          headers: admin.h,
        }),
      ]);
      const ghosts = await db.prisma.queueEntry.count({ where: { member: { isActive: false } } });
      expect(ghosts).toBe(0);
    }
    await app.close();
  });

  it('an inactive member is never in the allocation snapshot, and cannot join a queue even through a stale session', async () => {
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const Q = queueApi(wd);
    const admin = await session(wd, { admin: true });
    const [a, ghost] = await sessions(wd, 2, 'Ghost');
    await db.prisma.queueEntry.deleteMany();
    await joinInOrder(wd, [ghost!, a!], 'GEAR');
    const r = await openQueueRound(wd, admin, [{ name: 'G1', category: 'GEAR' }]);
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await db.prisma.member.update({ where: { id: ghost!.id }, data: { isActive: false } }); // entry left behind on purpose
    await A.close(admin.h, r.id);
    const snap = await db.prisma.roundQueueSnapshot.findMany({ where: { roundId: r.id } });
    expect(snap.map((s) => s.memberId)).toEqual([a!.id]);
    await expect(app.tx((t) => joinQueue(t, 'CARD', ghost!.id))).rejects.toMatchObject({
      code: 'MEMBER_INACTIVE',
    });
    await app.close();
  });
});

describe('M-4 production session secret', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@h/db?connection_limit=5&pool_timeout=5',
    DISCORD_CLIENT_ID: 'a',
    DISCORD_CLIENT_SECRET: 'b',
    DISCORD_REDIRECT_URI: 'http://x/cb',
    FRONTEND_URL: 'http://x',
    BOT_API_KEYS: 'a'.repeat(64),
  };
  it('placeholders, short and low-entropy secrets are refused in production; a real one is accepted; dev keeps working', () => {
    for (const bad of [
      'change-me-to-a-long-random-string-0000',
      'change-me-change-me-change-me-change-me-change-me',
      'a'.repeat(60),
      'abcdefghijklmnop'.repeat(1),
      'x'.repeat(30),
    ]) {
      expect(() => loadEnv({ ...base, SESSION_SECRET: bad }), bad).toThrow(/SESSION_SECRET/);
    }
    expect(() => loadEnv({ ...base, SESSION_SECRET: PROD_SECRET })).not.toThrow();
    expect(() =>
      loadEnv({ ...base, SESSION_SECRET: 'openssl-rand-base64-48-style/abc+DEF0123456789ghijklmnopqrstuv=' }),
    ).not.toThrow();
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', SESSION_SECRET: 'change-me-to-a-long-random-string-0000' }),
    ).not.toThrow();
  });
  it('.env.example ships an empty SESSION_SECRET so it must be generated', async () => {
    const { readFile } = await import('node:fs/promises');
    expect(await readFile('.env.example', 'utf8')).toMatch(/^SESSION_SECRET=\s*$/m);
  });
});

describe('M-5 session lifetime, purge and login audit', () => {
  const sess = async (discordId: string) => {
    await db.prisma.member.create({ data: { discordId, ign: `m5-${discordId}`, nickname: 'n', jobId: 2 } });
    const app = await createTestApp(db, { mock });
    await app.ready();
    return { app, ...(await loginAs(app, mock, discordId)) };
  };

  it('a session older than the absolute lifetime is refused even if its sliding expiry is fresh; refresh never extends past the cap', async () => {
    const { app, cookie } = await sess('6100001');
    const me = () => app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    expect((await me()).statusCode).toBe(200);
    // used every hour for 91 days (sliding expiry is always fresh), but the session is 91 days old
    const mine = db.prisma
      .$executeRaw`UPDATE "Session" SET "createdAt" = clock_timestamp() - interval '91 days',
      "lastSeen" = clock_timestamp() - interval '2 hours', "expiresAt" = clock_timestamp() + interval '20 days'
      WHERE "memberId" = (SELECT id FROM "Member" WHERE "discordId" = '6100001')`;
    await mine;
    expect((await me()).statusCode).toBe(401);
    // a 89-day-old session is valid, and its refresh is capped at day 90
    await db.prisma.$executeRaw`UPDATE "Session" SET "createdAt" = clock_timestamp() - interval '89 days',
      "lastSeen" = clock_timestamp() - interval '2 hours'
      WHERE "memberId" = (SELECT id FROM "Member" WHERE "discordId" = '6100001')`;
    expect((await me()).statusCode).toBe(200);
    const [row] = await db.prisma.$queryRaw<{ left: number }[]>`
      SELECT extract(epoch FROM ("expiresAt" - clock_timestamp()))::float AS "left" FROM "Session"
      WHERE "memberId" = (SELECT id FROM "Member" WHERE "discordId" = '6100001')`;
    expect(row!.left).toBeLessThan(1.1 * 86400); // about one day left, not 30
    await app.close();
  });

  it('SESSION_SLIDING_DAYS and SESSION_ABSOLUTE_DAYS are configurable and validated', async () => {
    const app = await createTestApp(db, {
      mock,
      env: { SESSION_SLIDING_DAYS: '2', SESSION_ABSOLUTE_DAYS: '5' },
    });
    await app.ready();
    await db.prisma.member.create({ data: { discordId: '6100002', ign: 'm5-cfg', nickname: 'n', jobId: 2 } });
    const { cb } = await loginAs(app, mock, '6100002');
    expect(cb.cookies.find((c) => c.name === 'session')!.maxAge).toBe(2 * 86400);
    await app.close();
    expect(() => testEnvWith({ SESSION_SLIDING_DAYS: '10', SESSION_ABSOLUTE_DAYS: '5' })).toThrow(
      /SESSION_ABSOLUTE_DAYS/,
    );
  });

  it('expired and over-age sessions are purged (function and sweeper); live ones stay', async () => {
    const m = await db.prisma.member.create({
      data: { discordId: '6100003', ign: 'm5-purge', nickname: 'n', jobId: 2 },
    });
    await db.prisma.session.deleteMany();
    const mk = (id: string, created: string, expires: string) =>
      db.prisma.$executeRawUnsafe(
        `INSERT INTO "Session" (id, "memberId", "createdAt", "expiresAt") VALUES ('${id}', '${m.id}', clock_timestamp() - interval '${created}', clock_timestamp() + interval '${expires}')`,
      );
    await mk('live', '1 day', '10 days');
    await mk('expired', '40 days', '-1 day');
    await mk('overage', '100 days', '5 days');
    expect(await purgeExpiredSessions(db.prisma, 90)).toBe(2);
    expect((await db.prisma.session.findMany()).map((s) => s.id)).toEqual(['live']);
    await mk('expired2', '40 days', '-2 days');
    const app = await createTestApp(db, { mock });
    await app.ready();
    await createSweeper({ prisma: db.prisma, tx: app.tx, sessionAbsoluteDays: 90 }).tick();
    expect((await db.prisma.session.findMany()).map((s) => s.id)).toEqual(['live']);
    await app.close();
  });

  it('login and logout are audited with the member and request id, never a token', async () => {
    const { app, cookie, cb } = await sess('6100004');
    const token = cookie!.replace('session=', '');
    expect(cb.statusCode).toBe(302);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie!, 'x-requested-with': 'x', origin: FRONTEND },
    });
    const logs = await db.prisma.auditLog.findMany({
      where: { action: { in: ['auth.login', 'auth.logout'] } },
      orderBy: { id: 'asc' },
    });
    const mine = logs.filter((l) => l.entityType === 'member').slice(-2);
    expect(mine.map((l) => l.action)).toEqual(['auth.login', 'auth.logout']);
    expect(mine.every((l) => l.actorType === 'MEMBER' && l.requestId)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(token);
    await app.close();
  });
});

function testEnvWith(extra: Record<string, string>) {
  return loadEnv({
    DATABASE_URL: 'postgresql://u:p@h/db?connection_limit=5&pool_timeout=5',
    SESSION_SECRET: 's'.repeat(40),
    DISCORD_CLIENT_ID: 'a',
    DISCORD_CLIENT_SECRET: 'b',
    DISCORD_REDIRECT_URI: 'http://x/cb',
    FRONTEND_URL: 'http://x',
    BOT_API_KEYS: 'a'.repeat(64),
    ...extra,
  });
}

describe('M-6 OAuth state failures for browsers', () => {
  it('a browser (Accept: text/html) is redirected to the frontend with authError; programmatic clients still get JSON', async () => {
    const app = await appWith();
    const cb = (headers: Record<string, string>, url = '/api/v1/auth/discord/callback?code=x&state=y') =>
      app.inject({ url, headers });
    const html = await cb({ accept: 'text/html,application/xhtml+xml' });
    expect(html.statusCode).toBe(302);
    expect(html.headers.location).toBe(`${FRONTEND}/?authError=AUTH_STATE_INVALID`);
    const json = await cb({ accept: 'application/json' });
    expect(json.statusCode).toBe(400);
    expect(json.json().error.code).toBe('AUTH_OAUTH_FAILED');
    expect((await cb({})).statusCode).toBe(400);
    await app.close();
  });

  it('replayed state and a code Discord rejects also redirect for browsers', async () => {
    const app = await appWith();
    await db.prisma.member.create({ data: { discordId: '6200001', ign: 'm6', nickname: 'n', jobId: 2 } });
    const login = await app.inject('/api/v1/auth/discord/login');
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const stateCookie = login.cookies.find((c) => c.name === 'oauth_state')!.value;
    const bad = await app.inject({
      url: `/api/v1/auth/discord/callback?code=unknown-code&state=${state}`,
      cookies: { oauth_state: stateCookie },
      headers: { accept: 'text/html' },
    });
    expect(bad.headers.location).toBe(`${FRONTEND}/?authError=AUTH_OAUTH_FAILED`);
    const replay = await app.inject({
      url: `/api/v1/auth/discord/callback?code=unknown-code&state=${state}`,
      cookies: { oauth_state: stateCookie },
      headers: { accept: 'text/html' },
    });
    expect(replay.headers.location).toBe(`${FRONTEND}/?authError=AUTH_STATE_INVALID`);
    await app.close();
  });
});

describe('trivial Low findings', () => {
  it('L-3 dev-login refuses an https FRONTEND_URL and the docker-compose host name "db"', () => {
    const okDb = 'postgresql://u:p@localhost:5432/x?connection_limit=5&pool_timeout=5';
    expect(() =>
      assertDevLoginAllowed({ DATABASE_URL: okDb, FRONTEND_URL: 'https://clover.example.com' }),
    ).toThrow(DevLoginRefused);
    expect(() =>
      assertDevLoginAllowed({ DATABASE_URL: okDb, FRONTEND_URL: 'http://localhost:5173' }),
    ).not.toThrow();
    expect(() => assertDevLoginAllowed({ DATABASE_URL: 'postgresql://u:p@db:5432/x' })).toThrow(
      /not a local database/,
    );
  });

  it('L-4 the dev seed refuses to run in production; L-6 hash-bot-key refuses short stdin keys', async () => {
    const base = { PATH: process.env.PATH!, HOME: process.env.HOME ?? '' };
    const seedRun = await run('node_modules/.bin/tsx', ['prisma/seed.ts', '--dev'], {
      env: { ...base, NODE_ENV: 'production', DATABASE_URL: db.url },
    }).catch((e) => e);
    expect(seedRun.code).toBe(1);
    expect(String(seedRun.stderr)).toContain('refused');
    const short = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = execFile(
        'node_modules/.bin/tsx',
        ['scripts/hash-bot-key.ts'],
        { env: base },
        (err, _o, stderr) => resolve({ code: (err as { code?: number } | null)?.code ?? 0, stderr }),
      );
      child.stdin!.end('tooshort');
    });
    expect(short.code).toBe(1);
    expect(short.stderr).toContain('shorter than 32');
    const long = await new Promise<string>((resolve) => {
      const child = execFile(
        'node_modules/.bin/tsx',
        ['scripts/hash-bot-key.ts'],
        { env: base },
        (_e, stdout) => resolve(stdout),
      );
      child.stdin!.end('k'.repeat(40));
    });
    expect(long.trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('L-7 image URLs must be https without credentials', async () => {
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const admin = await session(wd, { admin: true });
    const create = (imageUrl: string) =>
      A.create(admin.h, {
        type: 'LIVE_CLAIM',
        name: 'img',
        items: [{ name: 'a', category: 'PET', imageUrl }],
      });
    for (const bad of [
      'http://example.com/a.png',
      'https://user:pw@example.com/a.png',
      'javascript:alert(1)',
      'ftp://x/y',
    ]) {
      expect((await create(bad)).statusCode, bad).toBe(422);
    }
    expect((await create('https://example.com/a.png')).statusCode).toBe(201);
    await app.close();
  });

  it('L-5 a draft round is invisible on the write paths too (404, same as a missing round)', async () => {
    const app = await appWith();
    const wd = withApp(app);
    const A = api(wd);
    const Q = queueApi(wd);
    const admin = await session(wd, { admin: true });
    const me = await session(wd, {});
    await db.prisma.queueEntry.deleteMany();
    await joinInOrder(wd, [me], 'GEAR');
    const draft = (
      await A.create(admin.h, { type: 'QUEUE_RANKED', name: 'd', items: [{ name: 'g', category: 'GEAR' }] })
    ).json();
    const item = (await db.prisma.auctionItem.findFirstOrThrow({ where: { roundId: draft.id } })).id;
    expect((await Q.setPrefs(me.h, draft.id, [item])).statusCode).toBe(404);
    expect((await Q.setPrefs(me.h, 999999, [1])).statusCode).toBe(404);
    await app.close();
  });

  it('L-9 concurrent admin edits of one member leave an audit trail that matches the final row', async () => {
    const app = await appWith();
    const wd = withApp(app);
    const admin = await session(wd, { admin: true });
    const target = await wd.member('L9target');
    await Promise.all(
      ['Nick1', 'Nick2', 'Nick3', 'Nick4'].map((nickname) =>
        app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/members/${target.id}`,
          headers: admin.h,
          payload: { nickname },
        }),
      ),
    );
    const finalNick = (await db.prisma.member.findUniqueOrThrow({ where: { id: target.id } })).nickname;
    const audits = await db.prisma.auditLog.findMany({
      where: { action: 'member.update', entityId: target.id },
      orderBy: { id: 'asc' },
    });
    const chain = audits.map(
      (a) => (a.meta as { changes: { nickname: { from: string | null; to: string } } }).changes.nickname,
    );
    for (let i = 1; i < chain.length; i++) expect(chain[i]!.from).toBe(chain[i - 1]!.to); // each diff starts where the previous ended
    expect(chain[chain.length - 1]!.to).toBe(finalNick);
    await app.close();
  });
});
