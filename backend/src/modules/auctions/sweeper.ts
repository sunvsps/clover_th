import type { PrismaClient } from '@prisma/client';
import type { TxRunner } from '../../lib/tx.js';
import { expiredOpenRounds, finalizeRound } from './rounds.js';

/**
 * Closes OPEN rounds whose window ended. Lazy finalize (on read/start) and this timer call the same
 * finalizeRound, which takes the round FOR UPDATE, so a late sweep can never admit late claims (claims re-check
 * the window themselves). Also run once at process start for rounds that expired while the server was down.
 */
export function createSweeper(o: {
  prisma: PrismaClient;
  tx: TxRunner;
  log?: { error(o: object, m: string): void };
}) {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;

  async function tick(): Promise<number> {
    let closed = 0;
    for (const id of await expiredOpenRounds(o.prisma)) {
      if (await o.tx((t) => finalizeRound(t, id))) closed++;
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
