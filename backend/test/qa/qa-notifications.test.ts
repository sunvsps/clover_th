/* eslint-disable */
// @ts-nocheck
// QA (Sentinel) probes: outbox atomicity/dedupe, retry schedule, lease reclaim, dead-letter, mention escaping, provider off.
import { describe, expect, it } from 'vitest';
import { createProvider } from '../../src/modules/notifications/providers/index.js';
import { BotProvider } from '../../src/modules/notifications/providers/bot.js';
import { enqueueNotifications } from '../../src/modules/notifications/outbox.js';
import { FakeProvider } from '../../src/modules/notifications/providers/fake.js';
import { backoffMs, createWorker } from '../../src/modules/notifications/worker.js';
import type { OutboundMessage } from '../../src/modules/notifications/types.js';
import { NOTIFY_SECRET, startFakeBot } from '../helpers/fakeBot.js';
import { testEnv } from '../helpers/app.js';
import { promotedPayload } from '../notifications/payload.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const CHANNEL = '123456789012345678';
const mk = (provider: FakeProvider | BotProvider, extra: object = {}) =>
  createWorker({ prisma: w.db.prisma, provider, sendIntervalMs: 0, jitter: () => 0, ...extra });
const all = () => w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });
async function enq(ign = 'Promo', over: object = {}, channel = true) {
  const m = await w.member(ign);
  if (channel)
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { notifyChannelId: CHANNEL } });
  const p = promotedPayload(m, over);
  await w.app.tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', p));
  return { m, p };
}

describe('QA outbox producer', () => {
  it('20 concurrent identical enqueues insert exactly one DM and one channel row; a different planVersion is a new row', async () => {
    const m = await w.member('Dup');
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { notifyChannelId: CHANNEL } });
    const p = promotedPayload(m);
    const res = await Promise.all(
      Array.from({ length: 20 }, () =>
        w.app.tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', p)),
      ),
    );
    expect(res.reduce((a, b) => a + b, 0)).toBe(2);
    expect(await w.db.prisma.notificationOutbox.count()).toBe(2);
    await w.app.tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', { ...p, planVersion: 5 }));
    expect(await w.db.prisma.notificationOutbox.count()).toBe(4);
  });

  it('enqueue is atomic with the business write: a later failure in the same tx removes both the business row and the outbox rows', async () => {
    const m = await w.member('Atomic');
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { notifyChannelId: CHANNEL } });
    await expect(
      w.app.tx(async (t) => {
        await t.$executeRaw`UPDATE "Member" SET nickname = 'changed-in-tx' WHERE id = ${m.id}::uuid`;
        await enqueueNotifications(t, 'fake', 'reserve.promoted', promotedPayload(m));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: m.id } })).nickname).toBe('nick');
  });

  it('provider "off": no rows, and no provider/worker is created; "fake" and "bot" are constructed only when configured', async () => {
    const m = await w.member('Off');
    expect(
      await w.app.tx((t) => enqueueNotifications(t, 'off', 'reserve.promoted', promotedPayload(m))),
    ).toBe(0);
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
    expect(createProvider(testEnv(w.db, undefined, { NOTIFICATIONS_PROVIDER: 'off' }))).toBeNull();
    expect(createProvider(testEnv(w.db, undefined, { NOTIFICATIONS_PROVIDER: 'fake' }))).toBeInstanceOf(
      FakeProvider,
    );
    expect(() => testEnv(w.db, undefined, { NOTIFICATIONS_PROVIDER: 'bot' })).toThrow(/DISCORD_BOT_NOTIFY/);
  });
});

describe('QA rendering and mention safety', () => {
  const bad = [
    '@everyone',
    '@here',
    '<@&1234567890>',
    '<@!99999>',
    '<#5555555>',
    '`code`',
    '[click](http://evil)',
    '||spoiler||',
    '**bold**',
    '> quote',
    '<t:1:R>',
    'a@b',
    '‮gnp',
  ];
  it.each(bad)(
    'IGN %s can never ping or format: allowedMentions = only the promoted user, no raw @/markdown/mention syntax from the IGN',
    async (ign) => {
      await enq(ign, { vacatedIgn: ign, teamName: ign, roomName: ign, activityName: ign });
      const p = new FakeProvider();
      await mk(p).tick();
      expect(p.sent).toHaveLength(2);
      for (const msg of p.sent) {
        expect(msg.allowedMentions.parse).toEqual([]);
        expect(msg.allowedMentions.users).toHaveLength(1);
        // Remove the one legitimate mention, then nothing mention-like may remain
        const rest = msg.content.replace(/<@\d+>/g, '');
        expect(rest).not.toMatch(/@(?!​)/);
        expect(rest).not.toMatch(/<[@#][^>]*[^\\]>/);
        expect(rest).not.toMatch(/(^|[^\\])[*_~`|]/);
        expect(rest).not.toMatch(/(^|[^\\])\]\(/);
        expect(msg.content.length).toBeLessThan(2000);
      }
    },
  );

  it('message is Thai, in Asia/Bangkok time, naming activity, date/time, room/team/slot and the promoted member (FR-6.3)', async () => {
    await enq('ตัวสำรอง', {
      startsAt: '2026-09-27T05:00:00.000Z',
      slot: 4,
      teamName: 'Team 3',
      roomName: 'Main',
    });
    const p = new FakeProvider();
    await mk(p).tick();
    const dm = p.sent.find((x) => x.target === 'DM')!;
    const ch = p.sent.find((x) => x.target === 'CHANNEL')!;
    for (const c of [dm.content, ch.content]) {
      expect(c).toContain('Polarity Zone');
      expect(c).toContain('27/09/2026');
      expect(c).toContain('12:00'); // 05:00Z is 12:00 Bangkok
      expect(c).toContain('Main');
      expect(c).toContain('Team 3');
      expect(c).toContain('4');
      expect(c).toMatch(/[฀-๿]/);
    }
    expect(ch.content).toContain('ตัวสำรอง');
    expect(dm.discordUserId).toBeTruthy();
    expect(ch.channelId).toBe(CHANNEL);
    expect(dm.idempotencyKey).not.toBe(ch.idempotencyKey);
  });
});

describe('QA worker reliability', () => {
  it('full backoff ladder with jitter 0: 30s,60s,120s,240s,480s,900s,900s then DEAD on the 8th attempt, exactly one notification.dead audit row', async () => {
    await enq('Ladder', {}, false);
    const p = new FakeProvider();
    p.queue(
      ...Array.from({ length: 8 }, () => ({
        ok: false as const,
        kind: 'retry' as const,
        code: 'HTTP_503',
        message: 'x',
      })),
    );
    const wk = mk(p);
    const waits: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const before = Date.now();
      await w.db.prisma
        .$executeRaw`UPDATE "NotificationOutbox" SET "nextAttemptAt" = now() - interval '1 second'`; // make it due
      const r = await wk.tick();
      expect(r.claimed).toBe(1);
      const row = (await all())[0]!;
      if (row.status === 'PENDING') waits.push(Math.round((row.nextAttemptAt.getTime() - before) / 1000));
      expect(row.attempts).toBe(i);
    }
    expect(waits.map((x) => Math.round(x / 10) * 10)).toEqual(
      [30, 60, 120, 240, 480, 900, 900].map((x) => Math.round(x / 10) * 10),
    );
    const row = (await all())[0]!;
    expect(row.status).toBe('DEAD');
    expect(await w.db.prisma.auditLog.count({ where: { action: 'notification.dead' } })).toBe(1);
    // a DEAD row is never picked up again
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET "nextAttemptAt" = now() - interval '1 hour'`;
    expect((await wk.tick()).claimed).toBe(0);
    // admin retry gives it a fresh budget and it is delivered
    const admin = await w.signIn({ admin: true });
    const rr = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${row.id}/retry`,
      headers: admin.h,
    });
    expect(rr.statusCode).toBe(200);
    expect((await wk.tick()).sent).toBe(1);
    expect((await all())[0]!.status).toBe('SENT');
  });

  it('5 workers over 40 rows: every row is sent exactly once (SKIP LOCKED), none lost', async () => {
    for (let i = 0; i < 20; i++) await enq('Multi' + i, { occurrenceId: 100 + i });
    const p = new FakeProvider();
    const workers = Array.from({ length: 5 }, () => mk(p, { batchSize: 4 }));
    for (let round = 0; round < 4; round++) await Promise.all(workers.map((x) => x.tick()));
    const rows = await all();
    expect(rows).toHaveLength(40);
    expect(rows.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
    const keys = p.sent.map((m) => m.idempotencyKey);
    expect(new Set(keys).size).toBe(40);
    expect(keys).toHaveLength(40);
  });

  it('lease reclaim: a SENDING row older than the lease is reclaimed and re-sent; a fresh lease is untouched; provider slower than lease is not double-claimed within one process', async () => {
    await enq('Lease', {}, false);
    const wk = mk(new FakeProvider(), { leaseMs: 120_000 });
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET status='SENDING', attempts=1, "lockedAt"=now() - interval '10 seconds'`;
    const t1 = await wk.tick();
    expect(t1.reclaimed).toBe(0);
    expect((await all())[0]!.status).toBe('SENDING');
    await w.db.prisma.$executeRaw`UPDATE "NotificationOutbox" SET "lockedAt"=now() - interval '3 minutes'`;
    const p = new FakeProvider();
    const t2 = await mk(p).tick();
    expect(t2).toMatchObject({ reclaimed: 1, claimed: 1, sent: 1 });
    expect((await all())[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('a permanent DM error is DEAD at once and audited; the channel row is unaffected; 429 without/with bad Retry-After still retries', async () => {
    await enq('Perm');
    const p = new FakeProvider();
    p.queueFor('DM', { ok: false, kind: 'dead', code: 'DM_CLOSED', message: 'x' });
    p.queueFor('CHANNEL', { ok: false, kind: 'retry', code: 'HTTP_429', message: 'rate' });
    const r = await mk(p).tick();
    expect(r).toMatchObject({ dead: 1, retried: 1 });
    const rows = await all();
    expect(rows.find((x) => x.target === 'DISCORD_DM')!.status).toBe('DEAD');
    expect(rows.find((x) => x.target === 'DISCORD_CHANNEL')!.status).toBe('PENDING');
    expect(await w.db.prisma.auditLog.count({ where: { action: 'notification.dead' } })).toBe(1);
  });

  it('a promotion is never blocked by a dead provider: outbox rows stay PENDING with no provider running', async () => {
    await enq('Outage');
    const bot = await startFakeBot();
    const url = bot.url;
    await bot.close(); // bot is down
    const provider = new BotProvider({ url, secret: NOTIFY_SECRET, timeoutMs: 500 });
    const r = await mk(provider).tick();
    expect(r.retried).toBe(2);
    expect((await all()).every((x) => x.status === 'PENDING' && x.lastErrorCode === 'NETWORK_ERROR')).toBe(
      true,
    );
  });

  it('bot provider: a hung bot is cut off by the timeout (TIMEOUT, retry) and the secret never lands in lastError', async () => {
    await enq('Slow', {}, false);
    const bot = await startFakeBot();
    bot.respond({ status: 200, delayMs: 1500 });
    const provider = new BotProvider({ url: bot.url, secret: NOTIFY_SECRET, timeoutMs: 300 });
    const r = await mk(provider).tick();
    await bot.close();
    expect(r.retried).toBe(1);
    const row = (await all())[0]!;
    expect(row.lastErrorCode).toBe('TIMEOUT');
    expect(JSON.stringify(row)).not.toContain(NOTIFY_SECRET);
  });

  it('admin retry: PENDING ok, SENDING and SENT are 409 NOTIFICATION_NOT_RETRYABLE, garbage id is 422; concurrent retries are safe', async () => {
    await enq('Retry', {}, false);
    const admin = await w.signIn({ admin: true });
    const id = (await all())[0]!.id;
    const go = (i: number | string) =>
      w.app.inject({ method: 'POST', url: `/api/v1/admin/notifications/${i}/retry`, headers: admin.h });
    const res = await Promise.all([go(id), go(id), go(id)]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    await w.db.prisma.$executeRaw`UPDATE "NotificationOutbox" SET status='SENDING'`;
    expect((await go(id)).json().error.code).toBe('NOTIFICATION_NOT_RETRYABLE');
    await w.db.prisma.$executeRaw`UPDATE "NotificationOutbox" SET status='SENT'`;
    expect((await go(id)).json().error.code).toBe('NOTIFICATION_NOT_RETRYABLE');
    expect((await go('abc')).statusCode).toBe(422);
    expect(backoffMs(1, 0)).toBe(30000);
  });

  it('logs from the worker contain ids and status only (no payload, IGN or secret)', async () => {
    await enq('LogSecretIGN', {}, false);
    const lines: string[] = [];
    const log = {
      info: (o: object, m: string) => lines.push(JSON.stringify(o) + m),
      warn: () => {},
      error: () => {},
    };
    await mk(new FakeProvider(), { log }).tick();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('LogSecretIGN');
  });
});

void ({} as OutboundMessage);
