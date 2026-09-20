import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { hashBotKey } from '../../src/lib/botKey.js';
import { BOT_KEY, BOT_KEY_2, createTestApp } from '../helpers/app.js';
import { createTestDb, truncateAll, type TestDb } from '../helpers/db.js';
import { captureLogs } from '../helpers/logs.js';

let db: TestDb;
let app: Awaited<ReturnType<typeof createTestApp>>;
const logs = captureLogs();
const K = { 'x-bot-key': BOT_KEY };

beforeAll(async () => {
  db = await createTestDb();
  app = await createTestApp(db, { logStream: logs.stream, env: { LOG_LEVEL: 'info' } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.drop();
});
beforeEach(async () => {
  await truncateAll(db.prisma);
  await seed(db.prisma);
});

const put = (discordId: string, payload: unknown, headers: Record<string, string> = K) =>
  app.inject({ method: 'PUT', url: `/api/v1/bot/members/${discordId}`, headers, payload: payload as object });
const audits = () => db.prisma.auditLog.count();

describe('PUT /bot/members/:discordId', () => {
  it('creates (201), repeats (200) with no duplicate and no extra audit row', async () => {
    const a = await put('10001', { ign: 'Alpha', job: 'Knight' });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({
      discordId: '10001',
      ign: 'Alpha',
      nickname: null,
      job: { id: 2 },
      isIncomplete: true,
    });
    expect(await audits()).toBe(1);
    const b = await put('10001', { ign: 'Alpha', job: 'Knight' });
    expect(b.statusCode).toBe(200);
    expect(b.json().memberId).toBe(a.json().memberId);
    expect(await db.prisma.member.count()).toBe(1);
    expect(await audits()).toBe(1);
    const log = await db.prisma.auditLog.findFirstOrThrow();
    expect(log).toMatchObject({ actorType: 'BOT', action: 'member.create', entityType: 'member' });
  });

  it('an actual change updates (200) and writes an audit row; jobId works too', async () => {
    await put('10002', { ign: 'Beta', job: 'Knight' });
    const r = await put('10002', { ign: 'Beta2', jobId: 3, nickname: 'B' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      ign: 'Beta2',
      nickname: 'B',
      job: { id: 3, label: 'Wizard' },
      isIncomplete: false,
    });
    expect(await audits()).toBe(2);
  });

  it('nickname is kept when omitted and cleared only by an explicit null', async () => {
    await put('10003', { ign: 'Gamma', job: 'Knight', nickname: 'G' });
    expect((await put('10003', { ign: 'Gamma', job: 'Wizard' })).json().nickname).toBe('G');
    expect((await put('10003', { ign: 'Gamma', job: 'Wizard', nickname: null })).json().nickname).toBeNull();
  });

  it('stores IGN NFC-normalized and trimmed; Thai names round-trip', async () => {
    const r = await put('10004', { ign: '  café  ', job: 'Knight' });
    expect(r.json().ign).toBe('café');
    const t = await put('10005', { ign: 'แมวกระเป๋า', job: 'ดรูอิด' });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({ ign: 'แมวกระเป๋า', job: { id: 6 } });
  });

  it('missing or wrong key gives 401 BOT_KEY_INVALID and changes nothing', async () => {
    const none = await put('10006', { ign: 'X', job: 'Knight' }, {});
    const wrong = await put('10006', { ign: 'X', job: 'Knight' }, { 'x-bot-key': 'wrong-key' });
    for (const r of [none, wrong]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('BOT_KEY_INVALID');
    }
    expect(await db.prisma.member.count()).toBe(0);
    expect(await audits()).toBe(0);
  });

  it('the bot key never appears in logs (also on failures)', async () => {
    await put('10007', { ign: 'Logged', job: 'Knight' });
    await put('10007', { ign: 'Logged', job: 'Knight' }, { 'x-bot-key': 'leaky-wrong-key-value' });
    const text = logs.text();
    expect(text).toContain('/api/v1/bot/members/10007');
    expect(text).not.toContain(BOT_KEY);
    expect(text).not.toContain('leaky-wrong-key-value');
  });

  it('missing job, missing ign, both job and jobId: VALIDATION_ERROR 422 and no row', async () => {
    for (const payload of [
      { ign: 'X' },
      { job: 'Knight' },
      { ign: 'X', job: 'Knight', jobId: 2 },
      { ign: '   ', job: 'Knight' },
    ]) {
      const r = await put('10008', payload);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await db.prisma.member.count()).toBe(0);
  });

  it('unknown job label or id gives INVALID_JOB 422 and no row', async () => {
    for (const payload of [
      { ign: 'X', job: 'Bard' },
      { ign: 'X', jobId: 999 },
    ]) {
      const r = await put('10009', payload);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('INVALID_JOB');
    }
    expect(await db.prisma.member.count()).toBe(0);
  });

  it('a body containing isAdmin (or any unknown field) is rejected', async () => {
    const r = await put('10010', { ign: 'Sneaky', job: 'Knight', isAdmin: true });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
    expect(await db.prisma.member.count()).toBe(0);
  });

  it('a malformed discord id is rejected', async () => {
    expect((await put('abc', { ign: 'X', job: 'Knight' })).statusCode).toBe(422);
  });

  it('duplicate IGN (case-insensitive) gives DUPLICATE_IGN 409 and creates nothing', async () => {
    await put('10011', { ign: 'Same', job: 'Knight' });
    const r = await put('10012', { ign: 'sAME', job: 'Wizard' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('DUPLICATE_IGN');
    expect(await db.prisma.member.count()).toBe(1);
    expect(await audits()).toBe(1);
  });

  it('changing an IGN to one already used gives DUPLICATE_IGN and leaves the member unchanged', async () => {
    await put('10013', { ign: 'One', job: 'Knight' });
    await put('10014', { ign: 'Two', job: 'Knight' });
    const r = await put('10014', { ign: 'one', job: 'Knight' });
    expect(r.json().error.code).toBe('DUPLICATE_IGN');
    expect((await db.prisma.member.findUniqueOrThrow({ where: { discordId: '10014' } })).ign).toBe('Two');
  });

  it('bot upsert reactivates a deactivated member; reactivation with a taken IGN gives DUPLICATE_IGN', async () => {
    await put('10015', { ign: 'Back', job: 'Knight' });
    await app.inject({ method: 'POST', url: '/api/v1/bot/members/10015/deactivate', headers: K });
    await put('10016', { ign: 'Back', job: 'Knight' }); // IGN now reused by someone else
    const blocked = await put('10015', { ign: 'Back', job: 'Knight' });
    expect(blocked.json().error.code).toBe('DUPLICATE_IGN');
    expect((await db.prisma.member.findUniqueOrThrow({ where: { discordId: '10015' } })).isActive).toBe(
      false,
    );
    const ok = await put('10015', { ign: 'BackAgain', job: 'Knight' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().isActive).toBe(true);
  });

  it('10 concurrent identical upserts create exactly one member (one 201)', async () => {
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => put('10017', { ign: 'Race', job: 'Knight' })),
    );
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.every((r) => [200, 201].includes(r.statusCode))).toBe(true);
    expect(await db.prisma.member.count()).toBe(1);
  });
});

describe('POST /bot/members/:discordId/deactivate', () => {
  it('is idempotent: second call is 200 with no extra audit row', async () => {
    await put('20001', { ign: 'Leaver', job: 'Knight' });
    const url = '/api/v1/bot/members/20001/deactivate';
    const a = await app.inject({ method: 'POST', url, headers: K });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ isActive: false });
    const before = await audits();
    const b = await app.inject({ method: 'POST', url, headers: K });
    expect(b.statusCode).toBe(200);
    expect(await audits()).toBe(before);
    const m = await db.prisma.member.findUniqueOrThrow({ where: { discordId: '20001' } });
    expect(m.isActive).toBe(false);
    expect(m.deactivatedAt).not.toBeNull();
  });

  it('unknown member gives 404 MEMBER_NOT_FOUND; missing key 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/bot/members/99999/deactivate', headers: K });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('MEMBER_NOT_FOUND');
    const n = await app.inject({ method: 'POST', url: '/api/v1/bot/members/99999/deactivate' });
    expect(n.statusCode).toBe(401);
  });
});

describe('bot key rotation (two digests)', () => {
  it('both configured digests work; a removed one does not', async () => {
    const both = await createTestApp(db, {
      env: { BOT_API_KEYS: `${hashBotKey(BOT_KEY)},${hashBotKey(BOT_KEY_2)}` },
    });
    const only2 = await createTestApp(db, { env: { BOT_API_KEYS: hashBotKey(BOT_KEY_2) } });
    const call = (a: typeof both, key: string, id: string) =>
      a.inject({
        method: 'PUT',
        url: `/api/v1/bot/members/${id}`,
        headers: { 'x-bot-key': key },
        payload: { ign: `R${id}`, job: 'Knight' },
      });
    expect((await call(both, BOT_KEY, '30001')).statusCode).toBe(201);
    expect((await call(both, BOT_KEY_2, '30002')).statusCode).toBe(201);
    expect((await call(only2, BOT_KEY_2, '30003')).statusCode).toBe(201);
    expect((await call(only2, BOT_KEY, '30004')).statusCode).toBe(401);
    await both.close();
    await only2.close();
  });
});
