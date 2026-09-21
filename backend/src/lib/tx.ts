import { Prisma, type PrismaClient } from '@prisma/client';
import { errors } from './errors.js';

export type Tx = Prisma.TransactionClient;
export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * The one way to open a transaction (design 3.4, B3).
 * - applies maxWait/timeout from env
 * - P2028 (could not start / timed out) becomes retryable 503 SERVICE_BUSY
 * - P2034 (serialization failure / deadlock) is retried once
 */
export function createTx(prisma: PrismaClient, opts: { maxWaitMs: number; timeoutMs: number }): TxRunner {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    prisma.$transaction(fn, { maxWait: opts.maxWaitMs, timeout: opts.timeoutMs });
  return async (fn) => {
    try {
      return await run(fn);
    } catch (err) {
      if (isCode(err, 'P2034')) {
        try {
          return await run(fn);
        } catch (err2) {
          throw mapTxError(err2);
        }
      }
      throw mapTxError(err);
    }
  };
}

function isCode(err: unknown, code: string) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

function mapTxError(err: unknown) {
  return isCode(err, 'P2028') ? errors.serviceBusy() : err;
}
