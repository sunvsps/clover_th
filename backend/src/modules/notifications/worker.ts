import type { NotificationOutbox, PrismaClient } from '@prisma/client';
import { record } from '../../lib/audit.js';
import { templateFor, type Target } from './templates/index.js';
import type { NotificationProvider, OutboundMessage, SendResult } from './types.js';

export const backoffMs = (attempts: number, jitter: number) =>
  Math.min(30_000 * 2 ** (attempts - 1), 15 * 60_000) * (1 + 0.1 * jitter);

export type WorkerOptions = {
  prisma: PrismaClient;
  provider: NotificationProvider;
  batchSize?: number;
  /** Minimum gap between sends (about 5 per second overall). */
  sendIntervalMs?: number;
  /** SENDING rows older than this are reclaimed (crash recovery). */
  leaseMs?: number;
  jitter?: () => number;
  log?: {
    info(o: object, m: string): void;
    warn(o: object, m: string): void;
    error(o: object, m: string): void;
  };
};

export type TickResult = { reclaimed: number; claimed: number; sent: number; retried: number; dead: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * In-process outbox worker (design 8.3). Claim is a short statement with SKIP LOCKED (an accidental second
 * instance is safe); sends happen OUTSIDE any transaction. Delivery is at-least-once.
 * Logs contain ids and status only, never secrets or payloads.
 */
export function createWorker(o: WorkerOptions) {
  const { prisma, provider } = o;
  const batch = o.batchSize ?? 10;
  const gap = o.sendIntervalMs ?? 200;
  const leaseSecs = (o.leaseMs ?? 120_000) / 1000;
  const jitter = o.jitter ?? Math.random;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;

  async function markDeadAudit(id: number, code: string | null, attempts: number) {
    await prisma.$transaction(async (tx) => {
      await record(tx, {
        actorType: 'SYSTEM',
        action: 'notification.dead',
        entityType: 'notification',
        entityId: String(id),
        meta: { code, attempts },
      });
    });
  }

  async function reclaim(): Promise<number> {
    // A crashed send already consumed its attempt; if that was the last one the row is DEAD, not retried forever.
    const rows = await prisma.$queryRaw<{ id: number; status: string; attempts: number }[]>`
      UPDATE "NotificationOutbox"
      SET status = CASE WHEN attempts >= "maxAttempts" THEN 'DEAD'::"NotifyStatus" ELSE 'PENDING'::"NotifyStatus" END,
          "lockedAt" = NULL, "lastErrorCode" = 'LEASE_EXPIRED', "updatedAt" = clock_timestamp()
      WHERE status = 'SENDING' AND "lockedAt" < clock_timestamp() - make_interval(secs => ${leaseSecs}::double precision)
      RETURNING id, status, attempts`;
    for (const r of rows) if (r.status === 'DEAD') await markDeadAudit(r.id, 'LEASE_EXPIRED', r.attempts);
    return rows.length;
  }

  async function claim(): Promise<NotificationOutbox[]> {
    return prisma.$queryRaw<NotificationOutbox[]>`
      UPDATE "NotificationOutbox"
      SET status = 'SENDING', "lockedAt" = clock_timestamp(), "updatedAt" = clock_timestamp(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM "NotificationOutbox"
        WHERE status = 'PENDING' AND "nextAttemptAt" <= clock_timestamp()
        ORDER BY "nextAttemptAt", id
        FOR UPDATE SKIP LOCKED LIMIT ${batch})
      RETURNING *`;
  }

  function toMessage(row: NotificationOutbox): OutboundMessage {
    const t = templateFor(row.eventType);
    const target: Target = row.target;
    const { content, mentionUserIds } = t.render(row.payload as never, target, 'th');
    const dm = target === 'DISCORD_DM';
    return {
      id: row.id,
      eventType: row.eventType,
      target: dm ? 'DM' : 'CHANNEL',
      ...(dm
        ? { discordUserId: row.recipientDiscordId ?? undefined }
        : { channelId: row.channelId ?? undefined }),
      content,
      allowedMentions: { parse: [], users: mentionUserIds },
      idempotencyKey: row.dedupeKey,
    };
  }

  async function settle(row: NotificationOutbox, r: SendResult): Promise<'sent' | 'retried' | 'dead'> {
    if (r.ok) {
      await prisma.$executeRaw`UPDATE "NotificationOutbox"
        SET status = 'SENT', "sentAt" = clock_timestamp(), "lockedAt" = NULL, "updatedAt" = clock_timestamp()
        WHERE id = ${row.id}`;
      return 'sent';
    }
    const err = r.message.slice(0, 500);
    if (r.kind === 'dead') {
      await prisma.$executeRaw`UPDATE "NotificationOutbox"
        SET status = 'DEAD', "lockedAt" = NULL, "lastError" = ${err}, "lastErrorCode" = ${r.code}, "updatedAt" = clock_timestamp()
        WHERE id = ${row.id}`;
      await markDeadAudit(row.id, r.code, row.attempts);
      return 'dead';
    }
    const waitMs = r.retryAfterMs ?? backoffMs(row.attempts, jitter());
    const res = await prisma.$queryRaw<{ status: string }[]>`
      UPDATE "NotificationOutbox"
      SET status = CASE WHEN attempts >= "maxAttempts" THEN 'DEAD'::"NotifyStatus" ELSE 'PENDING'::"NotifyStatus" END,
          "nextAttemptAt" = clock_timestamp() + make_interval(secs => ${waitMs / 1000}::double precision),
          "lockedAt" = NULL, "lastError" = ${err}, "lastErrorCode" = ${r.code}, "updatedAt" = clock_timestamp()
      WHERE id = ${row.id} RETURNING status`;
    if (res[0]?.status === 'DEAD') {
      await markDeadAudit(row.id, r.code, row.attempts);
      return 'dead';
    }
    return 'retried';
  }

  async function tick(): Promise<TickResult> {
    const out: TickResult = { reclaimed: await reclaim(), claimed: 0, sent: 0, retried: 0, dead: 0 };
    const rows = await claim();
    out.claimed = rows.length;
    for (const [i, row] of rows.entries()) {
      if (i > 0 && gap > 0) await sleep(gap);
      let result: SendResult;
      try {
        result = await provider.send(toMessage(row));
      } catch (err) {
        const known = (err as Error).message.startsWith('Unknown notification event type');
        result = known
          ? { ok: false, kind: 'dead', code: 'RENDER_ERROR', message: 'unknown event type' }
          : { ok: false, kind: 'retry', code: 'PROVIDER_ERROR', message: 'provider threw' };
      }
      const s = await settle(row, result);
      out[s]++;
      o.log?.info({ id: row.id, outcome: s, attempts: row.attempts }, 'notification processed');
    }
    return out;
  }

  return {
    tick,
    start(intervalMs = 2000) {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return; // never overlap ticks in one process
        running = tick()
          .catch((err) => o.log?.error({ err }, 'notification worker tick failed'))
          .finally(() => (running = null));
      }, intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await running;
    },
  };
}
