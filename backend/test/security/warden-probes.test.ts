// Warden security review probes (docs/security-review.md). Each test PRINTS its observation via console.log and
// mostly asserts nothing that would fail on a finding: they document behaviour, they do not gate CI.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { BOT_KEY, createTestApp } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { api, items, openRound, session } from '../auctions/helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma);
});
afterAll(() => db.drop());

let n = 0;
const w = (app: unknown) =>
  ({
    db,
    app,
    member: async (ign?: string, extra: Record<string, unknown> = {}) => {
      const m = await db.prisma.member.create({
        data: {
          discordId: String(7_100_000 + ++n),
          ign: ign ?? `wp-${n}-${Math.random()}`,
          nickname: 'n',
          jobId: 2,
          ...extra,
        },
      });
      return { id: m.id, discordId: m.discordId, ign: m.ign };
    },
  }) as never;

describe('WARDEN probes', () => {
  it('P1: TRUST_PROXY=true lets a client pick its own rate-limit / bot-guard identity via X-Forwarded-For', async () => {
    const app = await createTestApp(db, {
      env: { TRUST_PROXY: 'true', RATE_LIMIT_ANON_PER_MIN: '5', BOT_KEY_FAILS_PER_MIN: '3' },
    });
    await app.ready();
    // the proxy APPENDS the real client ip (nginx $proxy_add_x_forwarded_for); the attacker pre-seeds the header
    const codes: number[] = [];
    for (let i = 0; i < 30; i++)
      codes.push(
        (
          await app.inject({
            url: '/docs/json',
            remoteAddress: '10.0.0.1',
            headers: { 'x-forwarded-for': `1.2.3.${i}, 203.0.113.9` },
          })
        ).statusCode,
      );
    console.log(
      'P1a anon: 429 count with rotating leftmost XFF =',
      codes.filter((c) => c === 429).length,
      'of 30',
    );
    for (let i = 0; i < 4; i++)
      await app.inject({
        method: 'PUT',
        url: '/api/v1/bot/members/8800002',
        remoteAddress: '10.0.0.1',
        headers: { 'x-bot-key': 'wrong', 'x-forwarded-for': '198.51.100.7, 203.0.113.9' },
        payload: { ign: 'x', job: 'Knight' },
      });
    const legit = await app.inject({
      method: 'PUT',
      url: '/api/v1/bot/members/8800002',
      remoteAddress: '10.0.0.1',
      headers: { 'x-bot-key': BOT_KEY, 'x-forwarded-for': '198.51.100.7' },
      payload: { ign: 'BotOk', job: 'Knight' },
    });
    console.log(
      'P1b legit bot at 198.51.100.7 after spoofed failures ->',
      legit.statusCode,
      legit.json().error?.code,
    );
    await app.close();
  });

  it('P2: garbage-cookie requests hit the DB and are never rate limited (limiter runs after the session lookup)', async () => {
    const app = await createTestApp(db, { env: { RATE_LIMIT_ANON_PER_MIN: '5' } });
    await app.ready();
    const seen = new Map<number, number>();
    const t0 = Date.now();
    for (let i = 0; i < 400; i++) {
      const r = await app.inject({ url: '/api/v1/me', headers: { cookie: `session=${'x'.repeat(40)}${i}` } });
      seen.set(r.statusCode, (seen.get(r.statusCode) ?? 0) + 1);
    }
    console.log(
      'P2 /me garbage cookie x400 (anon limit 5):',
      Object.fromEntries(seen),
      `${Date.now() - t0}ms`,
    );
    const seen2 = new Map<number, number>();
    for (let i = 0; i < 20; i++) {
      const r = await app.inject({ url: '/api/v1/nope' });
      seen2.set(r.statusCode, (seen2.get(r.statusCode) ?? 0) + 1);
    }
    console.log('P2c unknown route x20 anon limit 5:', Object.fromEntries(seen2));
    await app.close();
  });

  it('P3: ETag ignores draft name/cap edits (stale 304 for the admin editing a draft)', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const W = w(app);
    const admin = await session(W, { admin: true });
    const A = api(W);
    const c = await A.create(admin.h, { type: 'LIVE_CLAIM', name: 'Old name', items: items(2) });
    const id = c.json().id;
    const etag = (await A.get(admin.h, id)).headers.etag as string;
    await A.patch(admin.h, id, { name: 'New name', winCap: 9 });
    console.log(
      'P3 after rename+cap change, conditional GET ->',
      (await A.get(admin.h, id, { 'if-none-match': etag })).statusCode,
      '(304 = stale)',
    );
    await A.patch(admin.h, id, {
      items: [
        { name: 'Renamed A', category: 'PET' },
        { name: 'Renamed B', category: 'PET' },
      ],
    });
    console.log(
      'P3b after item replace (same count) ->',
      (await A.get(admin.h, id, { 'if-none-match': etag })).statusCode,
    );
    await app.close();
  });

  it('P4: existence oracle for draft round ids', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const W = w(app);
    const admin = await session(W, { admin: true });
    const m = await session(W, {});
    const A = api(W);
    const c = await A.create(admin.h, {
      type: 'QUEUE_RANKED',
      name: 'Secret draft',
      items: [{ name: 'g', category: 'GEAR' }],
    });
    const id = c.json().id;
    const put = (rid: number) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/auctions/rounds/${rid}/preferences/me`,
        headers: m.h,
        payload: { itemIds: [] },
      });
    const get = (rid: number) => app.inject({ url: `/api/v1/auctions/rounds/${rid}`, headers: m.h });
    console.log(
      'P4 draft: GET',
      (await get(id)).statusCode,
      'PUT prefs',
      (await put(id)).statusCode,
      '| nonexistent: GET',
      (await get(99999)).statusCode,
      'PUT prefs',
      (await put(99999)).statusCode,
    );
    await app.close();
  });

  it('P5: CSRF matrix, prototype pollution, odd bodies, callback without state', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const W = w(app);
    const m = await session(W, {});
    const m2 = await session(W, {});
    const out = async (label: string, p: Promise<{ statusCode: number; body: string }>) => {
      const r = await p;
      console.log(label, r.statusCode, r.body.slice(0, 120));
    };
    await out(
      'P5 logout no XRW ->',
      app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: m.h.cookie! } }),
    );
    await out(
      'P5 logout wrong origin ->',
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: m2.h.cookie!, 'x-requested-with': 'x', origin: 'https://evil.example' },
      }),
    );
    await out(
      'P5 __proto__ body ->',
      app.inject({
        method: 'PUT',
        url: '/api/v1/events/polarity-zone/occurrences/2099-01-01/registrations/me',
        headers: { ...m.h, 'content-type': 'application/json' },
        payload: '{"__proto__":{"isAdmin":true},"status":"JOINED"}',
      }),
    );
    await out(
      'P5 text/plain ->',
      app.inject({
        method: 'PUT',
        url: '/api/v1/events/polarity-zone/occurrences/2099-01-01/registrations/me',
        headers: { ...m.h, 'content-type': 'text/plain' },
        payload: 'status=JOINED',
      }),
    );
    await out(
      'P5 callback without state cookie ->',
      app.inject({ url: '/api/v1/auth/discord/callback?code=abc&state=def' }),
    );
    await app.close();
  });

  it('P6: registration churn audit growth', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const W = w(app);
    const m = await session(W, {});
    const before = await db.prisma.auditLog.count();
    const d = new Date(Date.now() + 7 * 864e5);
    while ((d.getUTCDay() + 6) % 7 !== 6) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    let ok = 0;
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: 'PUT',
        url: `/api/v1/events/polarity-zone/occurrences/${date}/registrations/me`,
        headers: m.h,
        payload: { status: i % 2 ? 'LEAVE' : 'JOINED' },
      });
      if (r.statusCode === 200) ok++;
    }
    console.log('P6 100 toggles ok =', ok, 'audit rows added =', (await db.prisma.auditLog.count()) - before);
    await app.close();
  });

  it('P7: claim cap and winner uniqueness with 24 parallel claims on a cap-3 round', async () => {
    const app = await createTestApp(db, { env: { CLAIM_RATE_MAX: '1000' } });
    await app.ready();
    const W = w(app);
    const admin = await session(W, { admin: true });
    const a = await session(W, {});
    const round = await openRound(W, admin, { itemCount: 12, winCap: 3 });
    const A = api(W);
    const res = await Promise.all(
      round.itemIds.flatMap((id) => [A.claim(a.h, round.id, id), A.claim(a.h, round.id, id)]),
    );
    const wins = await db.prisma.auctionItem.count({ where: { roundId: round.id, winnerId: a.id } });
    console.log('P7 wins =', wins, 'statuses', [...new Set(res.map((r) => r.statusCode))]);
    expect(wins).toBeLessThanOrEqual(3);
    await app.close();
  });

  it('P8: hostile filter values never 500', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const W = w(app);
    const admin = await session(W, { admin: true });
    const raw = (x: string) => (x.startsWith('%') ? x : encodeURIComponent(x));
    const bad = ["' OR 1=1 --", '%00', 'a b', '%ED%A0%80', 'x'.repeat(5000)];
    const out: number[] = [];
    for (const b of bad) {
      out.push(
        (
          await app.inject({
            url: `/api/v1/admin/audit-log?action=${raw(b)}&actor=${raw(b)}`,
            headers: admin.h,
          })
        ).statusCode,
      );
      out.push(
        (await app.inject({ url: `/api/v1/events/${raw(b)}/occurrences/2099-01-01/plan`, headers: admin.h }))
          .statusCode,
      );
    }
    console.log('P8 statuses', out);
    expect(out.every((s) => s < 500)).toBe(true);
    await app.close();
  });

  it('P9: production docs and error/headers', async () => {
    const app = await createTestApp(db, { env: { NODE_ENV: 'production' } });
    await app.ready();
    console.log('P9 prod /docs/json', (await app.inject('/docs/json')).statusCode);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/bot/members/123456',
      headers: { 'x-bot-key': BOT_KEY, 'content-type': 'application/json' },
      payload: '{bad',
    });
    console.log('P9 malformed json ->', r.statusCode, r.body);
    const h = (await app.inject('/healthz')).headers;
    console.log('P9 headers', {
      csp: !!h['content-security-policy'],
      hsts: h['strict-transport-security'],
      xpb: h['x-powered-by'],
    });
    await app.close();
  });
});
