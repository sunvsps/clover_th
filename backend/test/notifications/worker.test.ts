import { describe, expect, it } from 'vitest';
import { enqueueNotifications } from '../../src/modules/notifications/outbox.js';
import { FakeProvider } from '../../src/modules/notifications/providers/fake.js';
import { backoffMs, createWorker } from '../../src/modules/notifications/worker.js';
import type { OutboundMessage } from '../../src/modules/notifications/types.js';
import { useWorld } from '../helpers/world.js';
import { promotedPayload } from './payload.js';

const w = useWorld();
const CHANNEL = '123456789012345678';

async function enqueue(opts: { channel?: boolean; ign?: string; over?: object } = {}) {
  const m = await w.member(opts.ign ?? 'Promo');
  if (opts.channel)
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { notifyChannelId: CHANNEL } });
  const p = promotedPayload(m, opts.over);
  await w.app.tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', p));
  return { m, p };
}
const mk = (provider: FakeProvider, extra: object = {}) =>
  createWorker({ prisma: w.db.prisma, provider, sendIntervalMs: 0, jitter: () => 0, ...extra });
const rows = () => w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });

describe('WP5 worker', () => {
  it('delivers a pending row: SENT with sentAt, a Thai message rendered in Bangkok time', async () => {
    const { m } = await enqueue({ channel: true });
    const fake = new FakeProvider();
    const r = await mk(fake).tick();
    expect(r).toMatchObject({ claimed: 2, sent: 2 });
    expect((await rows()).every((x) => x.status === 'SENT' && x.sentAt && x.attempts === 1)).toBe(true);
    const dm = fake.sent.find((s) => s.target === 'DM')!;
    expect(dm.discordUserId).toBe(m.discordId);
    expect(dm.content).toContain('วันที่ 27/09/2026 เวลา 12:00 น.'); // 05:00Z = 12:00 Asia/Bangkok
    expect(dm.content).toContain('Team 3');
    expect(dm.idempotencyKey).toMatch(/:dm$/);
    expect(fake.sent.find((s) => s.target === 'CHANNEL')!.channelId).toBe(CHANNEL);
  });

  it('a 503 retries with growing nextAttemptAt and ends DEAD after maxAttempts, writing notification.dead to the audit log', async () => {
    await enqueue();
    const fake = new FakeProvider();
    fake.queue(
      ...Array.from({ length: 8 }, () => ({
        ok: false as const,
        kind: 'retry' as const,
        code: 'HTTP_503',
        message: 'bot returned 503',
      })),
    );
    const worker = mk(fake);
    const delays: number[] = [];
    for (let i = 1; i <= 8; i++) {
      await w.db.prisma
        .$executeRaw`UPDATE "NotificationOutbox" SET "nextAttemptAt" = clock_timestamp() - interval '1 second' WHERE status = 'PENDING'`;
      await worker.tick();
      const [r] = await w.db.prisma.$queryRaw<{ status: string; secs: number }[]>`
        SELECT status, extract(epoch FROM ("nextAttemptAt" - "updatedAt"))::float AS secs FROM "NotificationOutbox"`;
      if (i < 8) {
        expect(r!.status).toBe('PENDING');
        delays.push(Math.round(r!.secs));
      } else expect(r!.status).toBe('DEAD');
    }
    expect(delays).toEqual([30, 60, 120, 240, 480, 900, 900]); // doubles, capped at 15 minutes
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'DEAD', attempts: 8, lastErrorCode: 'HTTP_503' });
    const audit = await w.db.prisma.auditLog.findMany({ where: { action: 'notification.dead' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'SYSTEM', entityId: String(row!.id) });
  });

  it('a DM_CLOSED reply is DEAD immediately without retrying, while the channel row is still delivered', async () => {
    await enqueue({ channel: true });
    const fake = new FakeProvider();
    fake.queueFor('DM', { ok: false, kind: 'dead', code: 'DM_CLOSED', message: 'bot rejected: DM_CLOSED' });
    await mk(fake).tick();
    const [dm, ch] = await rows();
    expect(dm).toMatchObject({
      target: 'DISCORD_DM',
      status: 'DEAD',
      attempts: 1,
      lastErrorCode: 'DM_CLOSED',
    });
    expect(ch).toMatchObject({ target: 'DISCORD_CHANNEL', status: 'SENT' });
    await mk(fake).tick();
    expect(fake.attempts.filter((a) => a.target === 'DM')).toHaveLength(1); // never retried
    expect(await w.db.prisma.auditLog.count({ where: { action: 'notification.dead' } })).toBe(1);
  });

  it('a 429 honors Retry-After', async () => {
    await enqueue();
    const fake = new FakeProvider();
    fake.queue({ ok: false, kind: 'retry', code: 'HTTP_429', message: 'rate limited', retryAfterMs: 90_000 });
    await mk(fake).tick();
    const [r] = await w.db.prisma.$queryRaw<{ status: string; secs: number }[]>`
      SELECT status, extract(epoch FROM ("nextAttemptAt" - "updatedAt"))::float AS secs FROM "NotificationOutbox"`;
    expect(r!.status).toBe('PENDING');
    expect(Math.round(r!.secs)).toBe(90);
  });

  it('a worker killed mid-send has its lease reclaimed and the row is retried; a fresh lease is left alone', async () => {
    await enqueue({ channel: true });
    const [a, b] = await rows();
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET status = 'SENDING', attempts = 1, "lockedAt" = clock_timestamp() - interval '3 minutes' WHERE id = ${a!.id}`;
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET status = 'SENDING', attempts = 1, "lockedAt" = clock_timestamp() WHERE id = ${b!.id}`;
    const fake = new FakeProvider();
    const r = await mk(fake).tick();
    expect(r).toMatchObject({ reclaimed: 1, claimed: 1, sent: 1 });
    const [ra, rb] = await rows();
    expect(ra).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(rb).toMatchObject({ status: 'SENDING', attempts: 1 });
  });

  it('a stuck row on its last attempt is DEAD (audited), not retried forever', async () => {
    await enqueue();
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET status = 'SENDING', attempts = 8, "lockedAt" = clock_timestamp() - interval '5 minutes'`;
    const r = await mk(new FakeProvider()).tick();
    expect(r.reclaimed).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: 'DEAD', lastErrorCode: 'LEASE_EXPIRED' });
    expect(await w.db.prisma.auditLog.count({ where: { action: 'notification.dead' } })).toBe(1);
  });

  it('two workers running at once send each row exactly once (SKIP LOCKED)', async () => {
    for (let i = 0; i < 30; i++) await enqueue({ ign: `P${i}` });
    const counts = new Map<string, number>();
    class Slow extends FakeProvider {
      override async send(msg: OutboundMessage) {
        await new Promise((r) => setTimeout(r, 5));
        counts.set(msg.idempotencyKey, (counts.get(msg.idempotencyKey) ?? 0) + 1);
        return super.send(msg);
      }
    }
    const p1 = new Slow();
    const p2 = new Slow();
    const drain = async (wk: ReturnType<typeof mk>) => {
      for (let i = 0; i < 6; i++) await wk.tick();
    };
    await Promise.all([
      drain(mk(p1, { batchSize: 7 })),
      drain(mk(p2, { batchSize: 7 })),
      drain(mk(p1, { batchSize: 3 })),
    ]);
    expect(counts.size).toBe(30);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    const all = await rows();
    expect(all.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
    expect(p1.sent.length + p2.sent.length).toBe(30);
  });

  it('an IGN of @everyone cannot ping: allowedMentions is limited to the promoted user', async () => {
    const { m } = await enqueue({ channel: true, ign: '@everyone', over: { vacatedIgn: '@here' } });
    const fake = new FakeProvider();
    await mk(fake).tick();
    expect(fake.sent).toHaveLength(2);
    for (const s of fake.sent) {
      expect(s.allowedMentions).toEqual({ parse: [], users: [m.discordId] });
      expect(s.content).not.toContain('@everyone');
      expect(s.content).not.toContain('@here');
    }
    const channel = fake.sent.find((s) => s.target === 'CHANNEL')!;
    expect(channel.content).toContain(`<@${m.discordId}>`);
  });

  it('markdown in IGNs is escaped', async () => {
    await enqueue({ ign: '**bold**_x_' });
    const fake = new FakeProvider();
    await mk(fake).tick();
    expect(fake.sent[0]!.content).not.toContain('**bold**');
  });

  it('an unknown event type on a row is DEAD with RENDER_ERROR (never loops)', async () => {
    await w.db.prisma.notificationOutbox.create({
      data: {
        eventType: 'nope',
        target: 'DISCORD_CHANNEL',
        channelId: '1',
        payload: {},
        dedupeKey: 'k1',
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });
    await mk(new FakeProvider()).tick();
    expect((await rows())[0]).toMatchObject({ status: 'DEAD', lastErrorCode: 'RENDER_ERROR' });
  });

  it('a provider that throws is retried (PROVIDER_ERROR)', async () => {
    await enqueue();
    const boom = {
      send: async () => {
        throw new Error('secret token abc');
      },
    };
    await createWorker({ prisma: w.db.prisma, provider: boom, sendIntervalMs: 0 }).tick();
    const [r] = await rows();
    expect(r).toMatchObject({ status: 'PENDING', lastErrorCode: 'PROVIDER_ERROR' });
    expect(r!.lastError).not.toContain('secret');
  });

  it('rows not yet due are not claimed', async () => {
    await enqueue();
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET "nextAttemptAt" = clock_timestamp() + interval '1 hour'`;
    expect((await mk(new FakeProvider()).tick()).claimed).toBe(0);
  });

  it('backoff doubles from 30s and caps at 15 minutes', () => {
    expect([1, 2, 3, 6, 7, 8].map((n) => backoffMs(n, 0) / 1000)).toEqual([30, 60, 120, 900, 900, 900]);
    expect(backoffMs(1, 1) / 1000).toBeCloseTo(33);
  });
});
