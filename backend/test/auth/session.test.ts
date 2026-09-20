import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { requireAdmin, requireAuth } from '../../src/plugins/requireAdmin.js';
import { CSRF, createTestApp } from '../helpers/app.js';
import { loginAs } from '../helpers/auth.js';
import { createTestDb, truncateAll, type TestDb } from '../helpers/db.js';
import { startMockDiscord, type MockDiscord } from '../helpers/mockDiscord.js';

let db: TestDb;
let mock: MockDiscord;
let app: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  db = await createTestDb();
  mock = await startMockDiscord();
  app = await createTestApp(db, { mock });
  // Test-only routes (WP4+ adds real admin routes).
  app.get('/__t/admin', { onRequest: [requireAdmin] }, async () => ({ ok: true }));
  app.post('/__t/write', { onRequest: [requireAuth] }, async () => ({ ok: true }));
  app.get('/__t/read', { onRequest: [requireAuth] }, async () => ({ ok: true }));
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

const signIn = async (discordId: string, extra: Record<string, unknown> = {}) => {
  await db.prisma.member.create({
    data: { discordId, ign: `ign-${discordId}`, nickname: 'n', jobId: 1, ...extra },
  });
  return (await loginAs(app, mock, discordId)).cookie!;
};
const get = (url: string, cookie?: string) => app.inject({ url, ...(cookie ? { headers: { cookie } } : {}) });

describe('sessions', () => {
  it("a deactivated member's next request fails immediately (no cache)", async () => {
    const cookie = await signIn('4001');
    expect((await get('/api/v1/me', cookie)).statusCode).toBe(200);
    await db.prisma.member.update({ where: { discordId: '4001' }, data: { isActive: false } });
    const r = await get('/api/v1/me', cookie);
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('admin promotion and demotion take effect on the very next request', async () => {
    const cookie = await signIn('4002');
    const denied = await get('/__t/admin', cookie);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ADMIN_REQUIRED');
    await db.prisma.member.update({ where: { discordId: '4002' }, data: { isAdmin: true } });
    expect((await get('/__t/admin', cookie)).statusCode).toBe(200);
    expect((await get('/api/v1/me', cookie)).json().isAdmin).toBe(true);
    await db.prisma.member.update({ where: { discordId: '4002' }, data: { isAdmin: false } });
    expect((await get('/__t/admin', cookie)).statusCode).toBe(403);
  });

  it('no session write happens on every request; lastSeen/expiresAt refresh at most hourly', async () => {
    const cookie = await signIn('4003');
    const before = await db.prisma.session.findFirstOrThrow();
    for (let i = 0; i < 5; i++) await get('/api/v1/me', cookie);
    const after = await db.prisma.session.findFirstOrThrow();
    expect(after.lastSeen.getTime()).toBe(before.lastSeen.getTime());
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());

    await db.prisma
      .$executeRaw`UPDATE "Session" SET "lastSeen" = clock_timestamp() - interval '2 hours', "expiresAt" = clock_timestamp() + interval '1 day'`;
    const stale = await db.prisma.session.findFirstOrThrow();
    await get('/api/v1/me', cookie);
    const refreshed = await db.prisma.session.findFirstOrThrow();
    expect(refreshed.lastSeen.getTime()).toBeGreaterThan(stale.lastSeen.getTime() + 3600e3);
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3);
  });

  it('expired sessions and garbage cookies are rejected', async () => {
    const cookie = await signIn('4004');
    expect((await get('/api/v1/me', 'session=garbage')).statusCode).toBe(401);
    await db.prisma.$executeRaw`UPDATE "Session" SET "expiresAt" = clock_timestamp() - interval '1 second'`;
    expect((await get('/api/v1/me', cookie)).statusCode).toBe(401);
  });
});

describe('CSRF (cookie-authenticated state-changing routes only)', () => {
  it('rejects a cookie write without X-Requested-With, or with a foreign Origin', async () => {
    const cookie = await signIn('4005');
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/__t/write', headers: { cookie, ...headers } });
    const a = await post({});
    expect(a.statusCode).toBe(403);
    expect(a.json().error.code).toBe('CSRF_REJECTED');
    expect((await post({ 'x-requested-with': 'x', origin: 'http://evil.example' })).statusCode).toBe(403);
    expect((await post({ ...CSRF })).statusCode).toBe(200);
    expect((await post({ 'x-requested-with': 'x' })).statusCode).toBe(200);
  });

  it('GET needs no CSRF header; a write with no cookie hits AUTH_REQUIRED, not CSRF', async () => {
    const cookie = await signIn('4006');
    expect((await get('/__t/read', cookie)).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/__t/write' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('AUTH_REQUIRED');
  });
});
