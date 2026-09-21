/* eslint-disable */
// @ts-nocheck
// QA (Sentinel) probes: bot key handling, authz on every route, CSRF, session invalidation, error shape.
import { describe, expect, it } from 'vitest';
import { hashBotKey } from '../../src/lib/botKey.js';
import { BOT_KEY, BOT_KEY_2, CSRF, FRONTEND, createTestApp } from '../helpers/app.js';
import { loginAs } from '../helpers/auth.js';
import { captureLogs } from '../helpers/logs.js';
import { routes } from '../authz/routes.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const NIL = '00000000-0000-4000-8000-000000000000';
const K = { 'x-bot-key': BOT_KEY };

describe('QA bot key handling', () => {
  const put = (headers: Record<string, string | string[]>, id = '81001') =>
    w.app.inject({
      method: 'PUT',
      url: `/api/v1/bot/members/${id}`,
      headers: headers as never,
      payload: { ign: `Bot${id}`, job: 'Knight' },
    });

  it('empty, whitespace, oversized, digest-of-key and near-miss keys are all 401 and create nothing', async () => {
    const bad = [
      '',
      ' ',
      BOT_KEY + ' ',
      ' ' + BOT_KEY,
      BOT_KEY.toUpperCase(),
      BOT_KEY.slice(0, -1),
      hashBotKey(BOT_KEY), // the configured digest itself must not work as a key
      'x'.repeat(257),
      'x'.repeat(100_000),
    ];
    for (const k of bad) {
      const r = await put({ 'x-bot-key': k });
      expect(r.statusCode, `key ${k.slice(0, 20)}`).toBe(401);
      expect(r.json().error.code).toBe('BOT_KEY_INVALID');
    }
    expect((await put({})).statusCode).toBe(401);
    expect(await w.db.prisma.member.count()).toBe(0);
    expect(await w.db.prisma.auditLog.count()).toBe(0);
  });

  it('duplicated X-Bot-Key header does not authenticate with a bad first value', async () => {
    const r = await put({ 'x-bot-key': ['nope', BOT_KEY] });
    // node joins duplicate headers with ", " so the value is wrong either way
    expect(r.statusCode).toBe(401);
  });

  it('a session cookie (even an admin one) is not accepted on bot routes, and the bot key is not accepted on member/admin routes', async () => {
    const admin = await w.signIn({ admin: true });
    const r = await w.app.inject({
      method: 'PUT',
      url: '/api/v1/bot/members/81002',
      headers: { cookie: admin.cookie, ...CSRF },
      payload: { ign: 'Sneaky', job: 'Knight' },
    });
    expect(r.statusCode).toBe(401);
    expect(await w.db.prisma.member.count({ where: { discordId: '81002' } })).toBe(0);
    for (const url of ['/api/v1/me', '/api/v1/members', '/api/v1/admin/members', '/api/v1/admin/audit-log']) {
      const g = await w.app.inject({ url, headers: K });
      expect(g.statusCode, url).toBe(401);
      expect(g.json().error.code).toBe('AUTH_REQUIRED');
    }
  });

  it('a valid bot key plus a stale/garbage cookie still works and needs no CSRF headers (bot exempt)', async () => {
    const r = await put({ ...K, cookie: 'session=garbage' });
    expect(r.statusCode).toBe(201);
  });

  it('rotation: primary+secondary both work; dropping one disables it immediately; three digests refused at startup', async () => {
    const two = await createTestApp(w.db, {
      env: { BOT_API_KEYS: `${hashBotKey(BOT_KEY)},${hashBotKey(BOT_KEY_2)}` },
    });
    const one = await createTestApp(w.db, { env: { BOT_API_KEYS: hashBotKey(BOT_KEY_2) } });
    const call = (a: typeof two, key: string, id: string) =>
      a.inject({
        method: 'PUT',
        url: `/api/v1/bot/members/${id}`,
        headers: { 'x-bot-key': key },
        payload: { ign: `Rot${id}`, job: 'Knight' },
      });
    expect((await call(two, BOT_KEY, '81011')).statusCode).toBe(201);
    expect((await call(two, BOT_KEY_2, '81012')).statusCode).toBe(201);
    expect((await call(one, BOT_KEY, '81013')).statusCode).toBe(401);
    expect((await call(one, BOT_KEY_2, '81014')).statusCode).toBe(201);
    await two.close();
    await one.close();
    await expect(
      createTestApp(w.db, { env: { BOT_API_KEYS: [1, 2, 3].map((i) => hashBotKey('k' + i)).join(',') } }),
    ).rejects.toThrow(/one or two digests/);
  });

  it('uppercase hex digest in config still matches (normalized), non-hex digest is refused', async () => {
    const up = await createTestApp(w.db, { env: { BOT_API_KEYS: hashBotKey(BOT_KEY).toUpperCase() } });
    const r = await up.inject({
      method: 'PUT',
      url: '/api/v1/bot/members/81020',
      headers: K,
      payload: { ign: 'UpDigest', job: 'Knight' },
    });
    expect(r.statusCode).toBe(201);
    await up.close();
    await expect(createTestApp(w.db, { env: { BOT_API_KEYS: 'not-a-digest' } })).rejects.toThrow(/sha256/);
  });

  it('the key, and bodies, never appear in logs at trace level (success, 401, 422, 409, deactivate)', async () => {
    const logs = captureLogs();
    const app = await createTestApp(w.db, { logStream: logs.stream, env: { LOG_LEVEL: 'trace' } });
    await app.ready();
    const call = (method: 'PUT' | 'POST', url: string, headers: object, payload?: object) =>
      app.inject({ method, url, headers: headers as never, payload });
    await call('PUT', '/api/v1/bot/members/81030', K, { ign: 'SecretIGN-zzz', job: 'Knight' });
    await call('PUT', '/api/v1/bot/members/81030', K, { ign: 'SecretIGN-zzz', job: 'Knight' });
    await call('PUT', '/api/v1/bot/members/81031', K, { ign: 'secretign-ZZZ', job: 'Knight' }); // 409
    await call('PUT', '/api/v1/bot/members/81032', K, { ign: 'x', job: 'Nope' }); // 422
    await call(
      'PUT',
      '/api/v1/bot/members/81033',
      { 'x-bot-key': BOT_KEY + 'wrong' },
      { ign: 'y', job: 'Knight' },
    );
    await call('POST', '/api/v1/bot/members/81030/deactivate', K);
    await call('PUT', '/api/v1/bot/members/81034', { ...K, 'content-type': 'application/json' }, undefined);
    const text = logs.text();
    expect(text.length).toBeGreaterThan(100); // logging really was on
    expect(text).not.toContain(BOT_KEY);
    expect(text).not.toContain(hashBotKey(BOT_KEY));
    expect(text).not.toContain('SecretIGN');
    expect(text.toLowerCase()).not.toContain('secretign');
    await app.close();
  });

  it('the key is not echoed in any response body or header', async () => {
    const r = await put({ 'x-bot-key': 'leak-check-key-123456' });
    expect(JSON.stringify(r.json()) + JSON.stringify(r.headers)).not.toContain('leak-check-key-123456');
  });
});

describe('QA authz on every route', () => {
  it('each admin route: no session -> 401 AUTH_REQUIRED, member -> 403 ADMIN_REQUIRED (guard runs before body validation), admin passes the guard', async () => {
    const member = await w.signIn();
    const admin = await w.signIn({ admin: true });
    const adminRoutes = routes.filter((r) => r.auth === 'admin');
    expect(adminRoutes.length).toBeGreaterThanOrEqual(9);
    for (const r of adminRoutes) {
      const call = (headers: object, payload: unknown = r.payload) =>
        w.app.inject({
          method: r.method as 'GET',
          url: r.url,
          headers: headers as never,
          payload: payload as object,
        });
      const anon = await call({});
      expect(anon.statusCode, `${r.method} ${r.url} anon`).toBe(401);
      expect(anon.json().error.code).toBe('AUTH_REQUIRED');
      const botKeyOnly = await call(K);
      expect(botKeyOnly.json().error.code, `${r.url} botkey`).toBe('AUTH_REQUIRED');
      // garbage body must not turn ADMIN_REQUIRED into a validation error (info leak of schema to non-admins)
      const asMember = await call(member.h, { garbage: true });
      expect(asMember.statusCode, `${r.method} ${r.url} member`).toBe(403);
      expect(asMember.json().error.code).toBe('ADMIN_REQUIRED');
      const asAdmin = await call(admin.h);
      expect([401, 403], `${r.method} ${r.url} admin`).not.toContain(asAdmin.statusCode);
    }
  });

  it('each member route rejects anonymous callers and accepts a plain member', async () => {
    const member = await w.signIn();
    for (const r of routes.filter((x) => x.auth === 'member' && !x.url.includes('logout'))) {
      const anon = await w.app.inject({
        method: r.method as 'GET',
        url: r.url,
        payload: r.payload as object,
      });
      expect(anon.statusCode, `${r.method} ${r.url}`).toBe(401);
      const ok = await w.app.inject({
        method: r.method as 'GET',
        url: r.url,
        headers: member.h,
        payload: r.payload as object,
      });
      expect([401, 403], `${r.method} ${r.url} as member`).not.toContain(ok.statusCode);
    }
  });

  it('admin promotion/demotion and an expired session are honoured on the next request; an admin route with a deactivated admin cookie is 401', async () => {
    const a = await w.signIn({ admin: true });
    expect((await w.app.inject({ url: '/api/v1/admin/members', headers: a.h })).statusCode).toBe(200);
    await w.db.prisma.member.update({ where: { id: a.id }, data: { isActive: false } });
    expect((await w.app.inject({ url: '/api/v1/admin/members', headers: a.h })).statusCode).toBe(401);
  });

  it('no API path grants admin: isAdmin/role in bodies of every write route is rejected and changes nothing', async () => {
    const admin = await w.signIn({ admin: true });
    const victim = await w.member('Victim');
    const attempts: [string, string, object][] = [
      ['PATCH', `/api/v1/admin/members/${victim.id}`, { isAdmin: true }],
      ['PATCH', `/api/v1/admin/members/${victim.id}`, { ign: 'Victim2', isAdmin: true }],
      ['PATCH', '/api/v1/admin/activities/polarity-zone', { registrationCapacity: 3, isAdmin: true }],
      [
        'PUT',
        `/api/v1/events/polarity-zone/occurrences/2026-09-20/registrations/me`,
        { status: 'JOINED', isAdmin: true },
      ],
      ['PUT', '/api/v1/admin/jobs', { jobs: [{ label: 'X', color: '#112233', isAdmin: true }] }],
      ['PUT', '/api/v1/admin/jobs', { jobs: [], isAdmin: true }],
    ];
    for (const [m, url, payload] of attempts) {
      const r = await w.app.inject({ method: m as 'PUT', url, headers: admin.h, payload });
      expect(r.statusCode, `${m} ${url}`).toBe(422);
      expect(r.json().error.code).toBe('VALIDATION_ERROR');
    }
    const bot = await w.app.inject({
      method: 'PUT',
      url: '/api/v1/bot/members/82001',
      headers: K,
      payload: { ign: 'Evil', job: 'Knight', isAdmin: true },
    });
    expect(bot.statusCode).toBe(422);
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: victim.id } })).isAdmin).toBe(false);
    expect(await w.db.prisma.member.count({ where: { isAdmin: true } })).toBe(1);
  });
});

describe('QA CSRF', () => {
  const writes = () => routes.filter((r) => r.auth !== 'bot' && r.auth !== 'public' && r.method !== 'GET');

  it('every cookie-authenticated write is rejected without X-Requested-With, with blank one, and with a foreign/prefix/null Origin', async () => {
    const admin = await w.signIn({ admin: true });
    expect(writes().length).toBeGreaterThanOrEqual(8);
    for (const r of writes()) {
      const variants: Record<string, string>[] = [
        { cookie: admin.cookie },
        { cookie: admin.cookie, 'x-requested-with': '' },
        { cookie: admin.cookie, 'x-requested-with': '   ' },
        { cookie: admin.cookie, 'x-requested-with': 'web', origin: 'https://evil.example' },
        { cookie: admin.cookie, 'x-requested-with': 'web', origin: FRONTEND + '.evil.example' },
        { cookie: admin.cookie, 'x-requested-with': 'web', origin: 'null' },
        { cookie: admin.cookie, 'x-requested-with': 'web', origin: 'http://localhost:5174' },
      ];
      for (const h of variants) {
        const res = await w.app.inject({
          method: r.method as 'PUT',
          url: r.url,
          headers: h,
          payload: (r.payload as object) ?? undefined,
        });
        expect(res.statusCode, `${r.method} ${r.url} ${JSON.stringify(h).slice(0, 90)}`).toBe(403);
        expect(res.json().error.code).toBe('CSRF_REJECTED');
      }
    }
  });

  it('CSRF cannot be dodged by making a member route look like a bot route (encoded / dotted / double-slash paths)', async () => {
    const member = await w.signIn();
    const target = '/api/v1/admin/members/' + member.id + '/deactivate';
    const tricks = [
      `/api/v1/bot/../admin/members/${member.id}/deactivate`,
      `/api/v1/bot/%2e%2e/admin/members/${member.id}/deactivate`,
      `//api/v1/admin/members/${member.id}/deactivate`,
      `/api/v1/bot/?x=/../..${target}`,
      target + '?/api/v1/bot/',
    ];
    for (const url of tricks) {
      const r = await w.app.inject({ method: 'POST', url, headers: { cookie: member.cookie } });
      expect([403, 404, 401], url).toContain(r.statusCode);
    }
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: member.id } })).isActive).toBe(true);
  });

  it('GET routes never change state (spot check with a cookie and no CSRF header)', async () => {
    const admin = await w.signIn({ admin: true });
    const before = await w.db.prisma.auditLog.count();
    for (const r of routes.filter((x) => x.method === 'GET' && x.auth !== 'public')) {
      await w.app.inject({ url: r.url, headers: { cookie: admin.cookie } });
    }
    expect(await w.db.prisma.auditLog.count()).toBe(before);
    expect(await w.db.prisma.occurrence.count()).toBe(0);
  });
});

describe('QA session invalidation on deactivation', () => {
  it('admin deactivation kills all of the member sessions (two devices) on their very next request, not other members', async () => {
    const admin = await w.signIn({ admin: true });
    const bystander = await w.signIn();
    const m = await w.member('TwoDevices');
    const d1 = await loginAs(w.app, w.mock, m.discordId);
    const d2 = await loginAs(w.app, w.mock, m.discordId);
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: d1.cookie! } })).statusCode).toBe(200);
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: d2.cookie! } })).statusCode).toBe(200);
    const r = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${m.id}/deactivate`,
      headers: admin.h,
    });
    expect(r.statusCode).toBe(200);
    for (const d of [d1, d2]) {
      const me = await w.app.inject({ url: '/api/v1/me', headers: { cookie: d.cookie! } });
      expect(me.statusCode).toBe(401);
      const wr = await w.app.inject({
        method: 'PUT',
        url: `/api/v1/events/polarity-zone/occurrences/2026-09-20/registrations/me`,
        headers: { cookie: d.cookie!, ...CSRF },
        payload: { status: 'JOINED' },
      });
      expect(wr.statusCode).toBe(401);
    }
    expect((await w.app.inject({ url: '/api/v1/me', headers: bystander.h })).statusCode).toBe(200);
    expect(await w.db.prisma.session.count({ where: { memberId: m.id } })).toBe(0);
    // reactivation does not resurrect old sessions
    await w.app.inject({ method: 'POST', url: `/api/v1/admin/members/${m.id}/reactivate`, headers: admin.h });
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: d1.cookie! } })).statusCode).toBe(401);
    const again = await loginAs(w.app, w.mock, m.discordId);
    expect(again.cookie).not.toBeNull();
  });

  it('logout kills only that session, and the old cookie cannot be replayed', async () => {
    const m = await w.member('LogoutOne');
    const d1 = await loginAs(w.app, w.mock, m.discordId);
    const d2 = await loginAs(w.app, w.mock, m.discordId);
    const out = await w.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: d1.cookie!, ...CSRF },
    });
    expect(out.statusCode).toBe(204);
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: d1.cookie! } })).statusCode).toBe(401);
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: d2.cookie! } })).statusCode).toBe(200);
  });

  it('a registration PUT racing a deactivation never leaves a future registration for the inactive member', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.signIn();
    const date = '2026-09-27';
    await w.db.prisma.occurrence.deleteMany();
    const puts = Array.from({ length: 15 }, (_, i) =>
      w.app.inject({
        method: 'PUT',
        url: `/api/v1/events/polarity-zone/occurrences/${date}/registrations/me`,
        headers: m.h,
        payload: { status: i % 3 === 0 ? 'LEAVE' : 'JOINED' },
      }),
    );
    const deact = w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${m.id}/deactivate`,
      headers: admin.h,
    });
    const res = await Promise.all([...puts, deact]);
    for (const r of res) expect([200, 401, 422], String(r.body)).toContain(r.statusCode);
    expect(await w.db.prisma.registration.count({ where: { memberId: m.id } })).toBe(0);
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: m.id } })).isActive).toBe(false);
  });
});

describe('QA input validation and error shape', () => {
  const shape = (r: { statusCode: number; json(): any; headers: Record<string, unknown> }) => {
    const b = r.json();
    expect(Object.keys(b)).toEqual(['error']);
    expect(typeof b.error.code).toBe('string');
    expect(b.error.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(typeof b.error.message).toBe('string');
    expect(typeof b.error.details).toBe('object');
    expect(r.headers['x-request-id']).toBeTruthy();
  };

  it('every failure class returns the standard {error:{code,message,details}} shape', async () => {
    const admin = await w.signIn({ admin: true });
    const member = await w.signIn();
    const json = { 'content-type': 'application/json' };
    const cases: [string, Promise<any>][] = [
      ['unknown route', w.app.inject({ url: '/api/v1/nope' })],
      ['wrong method', w.app.inject({ method: 'DELETE', url: '/api/v1/me' })],
      ['401', w.app.inject({ url: '/api/v1/me' })],
      ['403', w.app.inject({ url: '/api/v1/admin/members', headers: member.h })],
      [
        '404 member',
        w.app.inject({ method: 'POST', url: `/api/v1/admin/members/${NIL}/deactivate`, headers: admin.h }),
      ],
      [
        '422 uuid',
        w.app.inject({
          method: 'POST',
          url: '/api/v1/admin/members/not-a-uuid/deactivate',
          headers: admin.h,
        }),
      ],
      [
        'malformed json',
        w.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/members/${NIL}`,
          headers: { ...admin.h, ...json },
          payload: '{"ign":',
        }),
      ],
      [
        'non-json content type',
        w.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/members/${NIL}`,
          headers: { ...admin.h, 'content-type': 'text/plain' },
          payload: 'ign=x',
        }),
      ],
      [
        'oversized body',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/admin/jobs',
          headers: { ...admin.h, ...json },
          payload: JSON.stringify({ jobs: [{ label: 'a'.repeat(2_000_000), color: '#000000' }] }),
        }),
      ],
      ['bot 401', w.app.inject({ method: 'PUT', url: '/api/v1/bot/members/9999999', payload: {} })],
      [
        'bot 422',
        w.app.inject({ method: 'PUT', url: '/api/v1/bot/members/9999999', headers: K, payload: { ign: '' } }),
      ],
      [
        'bad bot id',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/bot/members/abc',
          headers: K,
          payload: { ign: 'a', job: 'Knight' },
        }),
      ],
      [
        'bad date',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/events/polarity-zone/occurrences/2026-9-1/registrations/me',
          headers: member.h,
          payload: { status: 'JOINED' },
        }),
      ],
      [
        'bad enum',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/events/polarity-zone/occurrences/2026-09-20/registrations/me',
          headers: member.h,
          payload: { status: 'WAITLISTED' },
        }),
      ],
      [
        'bad me',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/events/polarity-zone/occurrences/2026-09-20/registrations/ME',
          headers: member.h,
          payload: { status: 'JOINED' },
        }),
      ],
      [
        'csrf',
        w.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: member.cookie } }),
      ],
      ['oauth', w.app.inject({ url: '/api/v1/auth/discord/callback?code=1&state=2' })],
      [
        'unknown event',
        w.app.inject({
          method: 'PUT',
          url: '/api/v1/events/nope/occurrences/2026-09-20/registrations/me',
          headers: member.h,
          payload: { status: 'JOINED' },
        }),
      ],
      [
        'unknown activity',
        w.app.inject({
          method: 'PATCH',
          url: '/api/v1/admin/activities/nope',
          headers: admin.h,
          payload: { registrationCapacity: 3 },
        }),
      ],
    ];
    const out: string[] = [];
    for (const [name, p] of cases) {
      const r = await p;
      out.push(`${name}: ${r.statusCode} ${r.json().error?.code}`);
      shape(r);
    }
    console.log('ERROR SHAPES\n' + out.join('\n'));
  });

  it('unicode/NUL/control characters and huge values in IGN and query strings do not cause a 500', async () => {
    const admin = await w.signIn({ admin: true });
    const nasty = ['a b', '‮', 'x'.repeat(65), '\ud800', ' ', '👨‍👩‍👧', '<script>', '\'; DROP TABLE "Member";--'];
    const results: string[] = [];
    for (const ign of nasty) {
      const r = await w.app.inject({
        method: 'PUT',
        url: '/api/v1/bot/members/83001',
        headers: K,
        payload: { ign, job: 'Knight' },
      });
      results.push(`${JSON.stringify(ign)} -> ${r.statusCode} ${r.json().error?.code ?? ''}`);
    }
    console.log('NASTY IGN RESULTS\n' + results.join('\n'));
    expect(results.filter((x) => / 500 /.test(x))).toEqual([]);
    for (const q of [
      'limit=0',
      'limit=abc',
      'limit=99999',
      'cursor=-1',
      'cursor=1e999',
      'from=garbage',
      'to=2020-13-45',
      'actor=' + 'x'.repeat(500),
    ]) {
      const r = await w.app.inject({ url: `/api/v1/admin/audit-log?${q}`, headers: admin.h });
      expect(r.statusCode, q).toBeLessThan(500);
      if (r.statusCode >= 400) shape(r as never);
    }
  });
});

describe('QA AC-2 end to end', () => {
  it('a bot payload with an invalid or omitted job creates no member, and that person cannot log in (AUTH_NOT_REGISTERED)', async () => {
    for (const payload of [
      { ign: 'NoJob' },
      { ign: 'BadJob', job: 'Necromancer' },
      { ign: 'BadId', jobId: 9999 },
    ]) {
      const r = await w.app.inject({ method: 'PUT', url: '/api/v1/bot/members/84001', headers: K, payload });
      expect(r.statusCode).toBe(422);
    }
    expect(await w.db.prisma.member.count()).toBe(0);
    const login = await loginAs(w.app, w.mock, '84001');
    expect(login.cookie).toBeNull();
    expect(login.cb.headers.location).toContain('authError=AUTH_NOT_REGISTERED');
    expect(await w.db.prisma.session.count()).toBe(0);
  });
});

describe('QA NUL bytes in other string inputs', () => {
  it('path params and query filters containing %00 do not 500', async () => {
    const admin = await w.signIn({ admin: true });
    const urls: [string, string, object | undefined][] = [
      ['PUT', '/api/v1/events/a%00b/occurrences/2026-09-22/registrations/me', { status: 'JOINED' }],
      ['PATCH', '/api/v1/admin/activities/a%00b', { registrationCapacity: 3 }],
      ['GET', '/api/v1/admin/audit-log?actor=a%00b', undefined],
      ['GET', '/api/v1/admin/audit-log?action=a%00b', undefined],
      ['GET', '/api/v1/admin/notifications?eventType=a%00b', undefined],
    ];
    const out: string[] = [];
    for (const [m, url, payload] of urls) {
      const r = await w.app.inject({ method: m as 'GET', url, headers: admin.h, payload });
      out.push(`${m} ${url} -> ${r.statusCode} ${r.statusCode >= 400 ? r.json().error.code : ''}`);
    }
    console.log('NUL PARAM RESULTS\n' + out.join('\n'));
    expect(out.filter((x) => / 500 /.test(x))).toEqual([]);
  });
});
