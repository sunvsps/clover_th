import type { PrismaClient } from '@prisma/client';
import { purgeExpiredSessions } from '../../lib/sessions.js';
import type { TxRunner } from '../../lib/tx.js';
import { expiredOpenRounds, finalizeRound } from './rounds.js';

/**
 * Background housekeeping, in-process (single instance):
 *  - closes OPEN rounds whose window ended. Lazy finalize (on read/start) and this timer call the same finalizeRound,
 *    which takes the round FOR UPDATE, so a late sweep can never admit late claims. It is the OWNER of finalization:
 *    each round is finalized in its own transaction and a failure is logged and skipped, so one bad round cannot block
 *    the others, and a failed finalize leaves no partial state (the transaction rolls back, the round stays OPEN and is
 *    retried on the next tick). Also run once at process start for rounds that expired while the server was down.
 *  - purges expired / over-age sessions once a day (and at start).
 */
export function createSweeper(o: {
  prisma: PrismaClient;
  tx: TxRunner;
  log?: { error(o: object, m: string): void };
  /** absolute session lifetime in days; enables the daily session purge */
  sessionAbsoluteDays?: number;
}) {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;
  let lastPurge = 0;

  async function tick(): Promise<number> {
    let closed = 0;
    for (const id of await expiredOpenRounds(o.prisma)) {
      try {
        if (await o.tx((t) => finalizeRound(t, id))) closed++;
      } catch (err) {
        o.log?.error({ err, roundId: id }, 'auction finalize failed; the round stays open and is retried');
      }
    }
    if (o.sessionAbsoluteDays !== undefined && Date.now() - lastPurge > 24 * 3600e3) {
      lastPurge = Date.now();
      try {
        await purgeExpiredSessions(o.prisma, o.sessionAbsoluteDays);
      } catch (err) {
        lastPurge = 0; // retry on the next tick
        o.log?.error({ err }, 'session purge failed');
      }
    }
    return closed;
  }

  return {
    tick,
    start(intervalMs = 1000) {
      if (timer) return;
      void tick().catch((err) => o.log?.error({ err }, 'auction sweep failed'));
      timer = setInterval(() => {
        if (running) return;
        running = tick()
          .catch((err) => o.log?.error({ err }, 'auction sweep failed'))
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
