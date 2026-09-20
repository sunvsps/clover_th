import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { IGN_INDEX } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pgErrors.js';
import { nameField, safeString } from '../../lib/text.js';
import { createTx } from '../../lib/tx.js';
import { resolveJob, upsertBotMember } from './upsert.js';

const row = z
  .object({
    discordId: z.string().regex(/^\d{5,25}$/),
    ign: nameField(64),
    job: safeString(64).optional(),
    jobId: z.number().int().positive().optional(),
    nickname: nameField(64).nullable().optional(),
  })
  .strict()
  .refine((r) => (r.job === undefined) !== (r.jobId === undefined), {
    message: 'exactly one of job / jobId',
  });

export type ImportResult = {
  discordId: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'failed';
  error?: string;
};

type Row = z.infer<typeof row>;
type Tx = Parameters<Parameters<ReturnType<typeof createTx>>[0]>[0];

const errorText = (err: unknown) =>
  isUniqueViolation(err, ...IGN_INDEX)
    ? 'DUPLICATE_IGN'
    : ((err as { code?: string }).code ?? (err as Error).message);

async function applyRow(t: Tx, r: Row): Promise<ImportResult['outcome']> {
  const job = await resolveJob(t, { job: r.job, jobId: r.jobId } as { job?: string; jobId?: number });
  const x = await upsertBotMember(
    t,
    { discordId: r.discordId, ign: r.ign, jobId: job.id, nickname: r.nickname },
    { actorType: 'SYSTEM', via: 'bulk-import' },
  );
  return x.created ? 'created' : x.changed ? 'updated' : 'unchanged';
}

const invalid = (raw: unknown, i: number, msg: string): ImportResult => ({
  discordId: String((raw as { discordId?: unknown })?.discordId ?? `#${i}`),
  outcome: 'failed',
  error: msg,
});

class DryRunDone extends Error {
  constructor(public results: ImportResult[]) {
    super('dry run');
  }
}

/**
 * One-time bot-style bulk upsert of the existing roster.
 * Real run: each row is its own transaction; failures do not stop the run.
 * Dry run: the WHOLE file runs in one transaction (a savepoint per row, so a failing row does not abort the
 * rest) that is always rolled back, so rows see each other exactly like a real run and in-file duplicate IGNs
 * are reported, while nothing is saved.
 */
export async function importMembers(
  prisma: PrismaClient,
  rows: unknown[],
  opts: { dryRun?: boolean } = {},
): Promise<ImportResult[]> {
  if (opts.dryRun) {
    const tx = createTx(prisma, { maxWaitMs: 10000, timeoutMs: 120000 });
    try {
      await tx(async (t) => {
        const results: ImportResult[] = [];
        for (const [i, raw] of rows.entries()) {
          const parsed = row.safeParse(raw);
          if (!parsed.success) {
            results.push(invalid(raw, i, parsed.error.issues.map((x) => x.message).join('; ')));
            continue;
          }
          await t.$executeRawUnsafe('SAVEPOINT import_row');
          try {
            results.push({ discordId: parsed.data.discordId, outcome: await applyRow(t, parsed.data) });
            await t.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
          } catch (err) {
            await t.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
            results.push({ discordId: parsed.data.discordId, outcome: 'failed', error: errorText(err) });
          }
        }
        throw new DryRunDone(results);
      });
    } catch (err) {
      if (err instanceof DryRunDone) return err.results;
      throw err;
    }
    return [];
  }

  const tx = createTx(prisma, { maxWaitMs: 10000, timeoutMs: 10000 });
  const out: ImportResult[] = [];
  for (const [i, raw] of rows.entries()) {
    const parsed = row.safeParse(raw);
    if (!parsed.success) {
      out.push(invalid(raw, i, parsed.error.issues.map((x) => x.message).join('; ')));
      continue;
    }
    try {
      out.push({ discordId: parsed.data.discordId, outcome: await tx((t) => applyRow(t, parsed.data)) });
    } catch (err) {
      out.push({ discordId: parsed.data.discordId, outcome: 'failed', error: errorText(err) });
    }
  }
  return out;
}
