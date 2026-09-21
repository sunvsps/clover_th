import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { BOT_KEY, createTestApp } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { session } from '../auctions/helpers.js';

// Rate limits, security headers and docs exposure with the settings a deployment would use.
const PROD_SECRET = 'Zk3vQ8mWn1Rt6YpLc0XbJd7HsGf2AeUo9iVxNq4TwK5yBz'; // production needs a real random secret (review M-4)
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma);
});
afterAll(() => db.drop());

const w = () =>
  ({
    db,
    member: async (ign?: string, extra: Record<string, unknown> = {}) => {
      const m = await db.prisma.member.create({
        data: {
          discordId: String(7_000_000 + Math.floor(Math.random() * 1e6)),
          ign: ign ?? `lim-${Math.random()}`,
          nickname: 'n',
          jobId: 2,
          ...extra,
        },
      });
      return { id: m.id, discordId: m.discordId, ign: m.ign };
    },
  }) as never;

describe('default rate limits (design 9)', () => {
  it('unauthenticated callers are limited per IP; signed-in callers per member; /healthz is never limited', async () => {
    const app = await createTestApp(db, {
      env: { RATE_LIMIT_ANON_PER_MIN: '10', RATE_LIMIT_AUTH_PER_MIN: '30' },
    });
    await app.ready();
    // anonymous budget: applies to public routes (protected ones reject at the auth guard first, which is cheap)
    const anon = [];
    for (let i = 0; i < 12; i++) anon.push((await app.inject('/docs/json')).statusCode);
    expect(anon.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(anon.slice(10)).toEqual([429, 429]);
    const a = await session(w(), {});
    const b = await session(w(), {});
    const codes: number[] = [];
    for (let i = 0; i < 32; i++)
      codes.push((await app.inject({ url: '/api/v1/me', headers: a.h })).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    const limited = await app.inject({ url: '/api/v1/me', headers: a.h });
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();
    expect((await app.inject({ url: '/api/v1/me', headers: b.h })).statusCode).toBe(200); // another member is unaffected
    for (let i = 0; i < 60; i++) expect((await app.inject('/healthz')).statusCode).toBe(200);
    await app.close();
  });

  it('wrong bot keys are throttled per IP (401 then 429) but the RIGHT key always passes: nobody can lock the real bot out (review H-1)', async () => {
    const app = await createTestApp(db, { env: { BOT_KEY_FAILS_PER_MIN: '5' } });
    await app.ready();
    const put = (key: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/bot/members/8800001',
        headers: { 'x-bot-key': key },
        payload: { ign: 'BotRate', job: 'Knight' },
      });
    for (let i = 0; i < 5; i++) expect((await put('wrong')).json().error.code).toBe('BOT_KEY_INVALID');
    // over the limit: further wrong keys are throttled (429) ...
    const blocked = await put('wrong');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(await db.prisma.member.count({ where: { discordId: '8800001' } })).toBe(0);
    // ... but the real bot is NOT locked out from the same address
    const real = await put(BOT_KEY);
    expect(real.statusCode).toBe(201);
    expect((await put(BOT_KEY)).statusCode).toBe(200);
    await app.close();
    // a correct key never counts as a failure
    const ok = await createTestApp(db, { env: { BOT_KEY_FAILS_PER_MIN: '2' } });
    await ok.ready();
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await ok.inject({
            method: 'PUT',
            url: '/api/v1/bot/members/8800002',
            headers: { 'x-bot-key': BOT_KEY },
            payload: { ign: 'BotOk', job: 'Knight' },
          })
        ).statusCode,
      ).toBeLessThan(300);
    }
    await ok.close();
  });

  it('the login and callback routes keep their own limit (30 per minute per IP)', async () => {
    const app = await createTestApp(db);
    await app.ready();
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (await app.inject('/api/v1/auth/discord/callback?code=x&state=y')).statusCode;
    expect(last).toBe(429);
    await app.close();
  });
});

describe('security headers and caching', () => {
  it('helmet headers are on every response, including errors; API JSON is never cached by shared caches', async () => {
    const app = await createTestApp(db);
    await app.ready();
    const me = await session(w(), {});
    for (const res of [
      await app.inject('/healthz'),
      await app.inject('/nope'),
      await app.inject('/api/v1/me'),
      await app.inject({ url: '/api/v1/me', headers: me.h }),
    ]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeTruthy();
      expect(res.headers['content-security-policy']).toBeTruthy();
      expect(res.headers['strict-transport-security']).toBeTruthy();
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
    expect((await app.inject({ url: '/api/v1/me', headers: me.h })).headers['cache-control']).toBe(
      'no-store',
    );
    expect((await app.inject('/api/v1/me')).headers['cache-control']).toBe('no-store'); // errors too
    await app.close();
  });
});

describe('/docs/json exposure (DOCS_ACCESS)', () => {
  const get = async (env: Record<string, string>, headers: Record<string, string> = {}) => {
    const app = await createTestApp(db, { env });
    await app.ready();
    const res = await app.inject({ url: '/docs/json', headers });
    await app.close();
    return res;
  };

  it('auto: public outside production, OFF (404) in production', async () => {
    expect((await get({})).statusCode).toBe(200);
    const prod = await get({ NODE_ENV: 'production', SESSION_SECRET: PROD_SECRET });
    expect(prod.statusCode).toBe(404);
    expect(prod.json().error.code).toBe('NOT_FOUND');
  });

  it('off and public are honoured in any environment', async () => {
    expect((await get({ DOCS_ACCESS: 'off' })).statusCode).toBe(404);
    expect(
      (await get({ NODE_ENV: 'production', SESSION_SECRET: PROD_SECRET, DOCS_ACCESS: 'public' })).statusCode,
    ).toBe(200);
  });

  it('admin: needs an admin session (401 anonymous, 403 member, 200 admin)', async () => {
    const env = { DOCS_ACCESS: 'admin' };
    expect((await get(env)).json().error.code).toBe('AUTH_REQUIRED');
    const member = await session(w(), {});
    expect((await get(env, member.h)).json().error.code).toBe('ADMIN_REQUIRED');
    const adm = await session(w(), { admin: true });
    expect((await get(env, adm.h)).statusCode).toBe(200);
  });
});
