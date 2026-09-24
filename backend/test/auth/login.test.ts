import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { CSRF, FRONTEND, createTestApp } from '../helpers/app.js';
import { loginAs } from '../helpers/auth.js';
import { createTestDb, truncateAll, type TestDb } from '../helpers/db.js';
import { captureLogs } from '../helpers/logs.js';
import { startMockDiscord, type MockDiscord } from '../helpers/mockDiscord.js';

let db: TestDb;
let mock: MockDiscord;
let app: Awaited<ReturnType<typeof createTestApp>>;
const logs = captureLogs();

beforeAll(async () => {
  db = await createTestDb();
  mock = await startMockDiscord();
  app = await createTestApp(db, { mock, logStream: logs.stream, env: { LOG_LEVEL: 'info' } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await mock.close();
  await db.drop();
});
beforeEach(async () => {
  await truncateAll(db.prisma);
  await seed(db.prisma);
});

const mk = (discordId: string, extra: Record<string, unknown> = {}) =>
  db.prisma.member.create({
    data: { discordId, ign: `ign-${discordId}`, nickname: 'nick', jobId: 2, ...extra },
  });

describe('OAuth login', () => {
  it('login redirects to Discord with state, client id and identify scope, and sets a signed state cookie', async () => {
    const res = await app.inject('/api/v1/auth/discord/login');
    expect(res.statusCode).toBe(302);
    const u = new URL(res.headers.location as string);
    expect(u.origin).toBe(mock.url);
    expect(u.searchParams.get('scope')).toBe('identify');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('test-client-id');
    expect(u.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    const c = res.cookies.find((x) => x.name === 'oauth_state')!;
    // app.inject is plain http (no TLS, no trusted X-Forwarded-Proto): Secure must be OFF, or Safari silently drops
    // the cookie and every login looks like AUTH_STATE_INVALID (the bug this guards against). set-cookie-parser
    // omits the `secure` key entirely when the attribute is absent from the header, so it must be undefined here.
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    expect(c.secure).toBeUndefined();
  });

  it('registered member: callback sets a cookie, redirects to the frontend, and /me returns the profile', async () => {
    await mk('111111111', { nickname: 'Nicky', isAdmin: false });
    const { cb, cookie } = await loginAs(app, mock, '111111111');
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${FRONTEND}/`);
    const sc = cb.cookies.find((c) => c.name === 'session')!;
    // same reasoning as the state cookie above: plain http here, so no Secure attribute (undefined, see note above)
    expect(sc).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(sc.secure).toBeUndefined();
    expect(sc.maxAge).toBe(30 * 86400);

    const me = await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body).toMatchObject({
      discordId: '111111111',
      ign: 'ign-111111111',
      nickname: 'Nicky',
      job: { id: 2, label: 'Knight' },
      isAdmin: false,
      isIncomplete: false,
    });
    expect(body.memberId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.serverTime).toISOString()).toBe(body.serverTime);
  });

  it('stores only a hash of the session token', async () => {
    await mk('222222222');
    const { cookie } = await loginAs(app, mock, '222222222');
    const token = cookie!.replace('session=', '');
    const rows = await db.prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(token);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3);
  });

  it('a member with no nickname reports isIncomplete = true in /me', async () => {
    await mk('333333333', { nickname: null });
    const { cookie } = await loginAs(app, mock, '333333333');
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    expect(me.json()).toMatchObject({ nickname: null, isIncomplete: true });
  });

  it('a MANUAL-source member is also incomplete', async () => {
    await mk('333333334', { source: 'MANUAL' });
    const { cookie } = await loginAs(app, mock, '333333334');
    expect((await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } })).json().isIncomplete).toBe(
      true,
    );
  });

  it('unregistered Discord user gets AUTH_NOT_REGISTERED via ?authError= and no session row', async () => {
    const { cb, cookie } = await loginAs(app, mock, '999999999');
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${FRONTEND}/?authError=AUTH_NOT_REGISTERED`);
    expect(cookie).toBeNull();
    expect(await db.prisma.session.count()).toBe(0);
  });

  it('inactive member gets AUTH_MEMBER_INACTIVE and no session', async () => {
    await mk('444444444', { isActive: false });
    const { cb, cookie } = await loginAs(app, mock, '444444444');
    expect(cb.headers.location).toBe(`${FRONTEND}/?authError=AUTH_MEMBER_INACTIVE`);
    expect(cookie).toBeNull();
    expect(await db.prisma.session.count()).toBe(0);
  });

  it('a reused OAuth state is rejected (even with the cookie replayed)', async () => {
    await mk('555555555');
    const first = await loginAs(app, mock, '555555555');
    expect(first.cb.statusCode).toBe(302);
    mock.registerCode('replay-code', '555555555');
    const replay = await app.inject({
      url: `/api/v1/auth/discord/callback?code=replay-code&state=${first.state}`,
      cookies: { oauth_state: first.stateCookie },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('AUTH_OAUTH_FAILED');
    expect(await db.prisma.session.count()).toBe(1);
  });

  it('missing cookie, tampered cookie and mismatched state are rejected', async () => {
    await mk('666666666');
    mock.registerCode('c1', '666666666');
    const login = await app.inject('/api/v1/auth/discord/login');
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const good = login.cookies.find((c) => c.name === 'oauth_state')!.value;

    const noCookie = await app.inject(`/api/v1/auth/discord/callback?code=c1&state=${state}`);
    expect(noCookie.json().error.code).toBe('AUTH_OAUTH_FAILED');
    const tampered = await app.inject({
      url: `/api/v1/auth/discord/callback?code=c1&state=${state}`,
      cookies: { oauth_state: good.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) },
    });
    expect(tampered.json().error.code).toBe('AUTH_OAUTH_FAILED');
    const wrong = await app.inject({
      url: `/api/v1/auth/discord/callback?code=c1&state=${'0'.repeat(32)}`,
      cookies: { oauth_state: good },
    });
    expect(wrong.json().error.code).toBe('AUTH_OAUTH_FAILED');
    expect(await db.prisma.session.count()).toBe(0);
  });

  it('a code Discord rejects gives AUTH_OAUTH_FAILED 400 and no session', async () => {
    await mk('777777777');
    const login = await app.inject('/api/v1/auth/discord/login');
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const res = await app.inject({
      url: `/api/v1/auth/discord/callback?code=unknown-code&state=${state}`,
      cookies: { oauth_state: login.cookies.find((c) => c.name === 'oauth_state')!.value },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUTH_OAUTH_FAILED');
    expect(await db.prisma.session.count()).toBe(0);
  });

  it('user cancelling at Discord (error=access_denied) redirects with authError', async () => {
    const login = await app.inject('/api/v1/auth/discord/login');
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const res = await app.inject({
      url: `/api/v1/auth/discord/callback?error=access_denied&state=${state}`,
      cookies: { oauth_state: login.cookies.find((c) => c.name === 'oauth_state')!.value },
    });
    expect(res.headers.location).toBe(`${FRONTEND}/?authError=AUTH_OAUTH_FAILED`);
  });

  it('logout needs the CSRF header, then destroys the session', async () => {
    await mk('888888888');
    const { cookie } = await loginAs(app, mock, '888888888');
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie! },
    });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe('CSRF_REJECTED');
    expect(await db.prisma.session.count()).toBe(1);

    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie!, ...CSRF },
    });
    expect(out.statusCode).toBe(204);
    expect(await db.prisma.session.count()).toBe(0);
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('the OAuth code, state, client secret and session token never appear in logs', async () => {
    await mk('121212121');
    const { cookie, state } = await loginAs(app, mock, '121212121');
    await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    const text = logs.text();
    expect(text).toContain('/api/v1/auth/discord/callback');
    expect(text).not.toMatch(/code-\d+/);
    expect(text).not.toContain(state);
    expect(text).not.toContain('test-client-secret-value');
    expect(text).not.toContain(cookie!.replace('session=', ''));
    expect(text).not.toMatch(/tok-code/);
  });
});

describe('Secure cookie attribute follows the request protocol (never hardcoded)', () => {
  // TRUST_PROXY_HOPS=1 lets a trusted X-Forwarded-Proto decide req.protocol (same mechanism test/security/fixes.test.ts
  // uses for X-Forwarded-For), simulating a TLS-terminating reverse proxy without needing a real HTTPS socket.
  const https = { remoteAddress: '10.0.0.1', headers: { 'x-forwarded-proto': 'https' } };

  it('plain http: the OAuth state cookie has no Secure attribute', async () => {
    const res = await app.inject({ url: '/api/v1/auth/discord/login' });
    expect(res.cookies.find((c) => c.name === 'oauth_state')!.secure).toBeUndefined();
  });

  it('a request behind a trusted TLS-terminating proxy: the state cookie IS Secure', async () => {
    const proxied = await createTestApp(db, { mock, env: { TRUST_PROXY_HOPS: '1' } });
    await proxied.ready();
    try {
      const res = await proxied.inject({ url: '/api/v1/auth/discord/login', ...https });
      expect(res.cookies.find((c) => c.name === 'oauth_state')).toMatchObject({ secure: true });
    } finally {
      await proxied.close();
    }
  });

  it('plain http end to end: the OAuth callback session cookie has no Secure attribute, and /me still works with it', async () => {
    await mk('232323232');
    const { cb, cookie } = await loginAs(app, mock, '232323232');
    expect(cb.cookies.find((c) => c.name === 'session')!.secure).toBeUndefined();
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(200);
    expect(me.json().discordId).toBe('232323232');
  });

  it('behind a trusted TLS-terminating proxy the session cookie IS Secure, and logout clears it the same way', async () => {
    await mk('242424242');
    const proxied = await createTestApp(db, { mock, env: { TRUST_PROXY_HOPS: '1' } });
    await proxied.ready();
    try {
      const login = await proxied.inject({ url: '/api/v1/auth/discord/login', ...https });
      const state = new URL(login.headers.location as string).searchParams.get('state')!;
      const stateCookie = login.cookies.find((c) => c.name === 'oauth_state')!.value;
      const code = 'code-secure-1';
      mock.registerCode(code, '242424242');
      const cb = await proxied.inject({
        url: `/api/v1/auth/discord/callback?code=${code}&state=${state}`,
        cookies: { oauth_state: stateCookie },
        ...https,
      });
      expect(cb.cookies.find((c) => c.name === 'session')).toMatchObject({ secure: true });
      const sessionCookie = `session=${cb.cookies.find((c) => c.name === 'session')!.value}`;
      const out = await proxied.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        remoteAddress: https.remoteAddress,
        headers: { cookie: sessionCookie, ...CSRF, ...https.headers },
      });
      expect(out.statusCode).toBe(204);
      expect(out.cookies.find((c) => c.name === 'session')).toMatchObject({ secure: true });
    } finally {
      await proxied.close();
    }
  });
});

describe('callback rate limit', () => {
  it('is limited per IP (31st request in a minute gets 429 RATE_LIMITED)', async () => {
    const a = await createTestApp(db, { mock });
    await a.ready();
    let last = 0;
    let code = '';
    for (let i = 0; i < 31; i++) {
      const r = await a.inject('/api/v1/auth/discord/callback?code=x&state=y');
      last = r.statusCode;
      code = r.json().error.code;
    }
    expect(last).toBe(429);
    expect(code).toBe('RATE_LIMITED');
    await a.close();
  });
});
