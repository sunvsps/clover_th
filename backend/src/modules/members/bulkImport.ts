import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { IGN_INDEX } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pgErrors.js';
import { createTx } from '../../lib/tx.js';
import { resolveJob, upsertBotMember } from './upsert.js';

const nm = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(1).max(max));
const row = z
  .object({
    discordId: z.string().regex(/^\d{5,25}$/),
    ign: nm(64),
    job: z.string().min(1).optional(),
    jobId: z.number().int().positive().optional(),
    nickname: nm(64).nullable().optional(),
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

/** One-time bot-style bulk upsert of the existing roster. Each row is its own transaction; failures do not stop the run. */
export async function importMembers(
  prisma: PrismaClient,
  rows: unknown[],
  opts: { dryRun?: boolean } = {},
): Promise<ImportResult[]> {
  const tx = createTx(prisma, { maxWaitMs: 10000, timeoutMs: 10000 });
  const out: ImportResult[] = [];
  for (const [i, raw] of rows.entries()) {
    const parsed = row.safeParse(raw);
    if (!parsed.success) {
      out.push({
        discordId: String((raw as { discordId?: unknown })?.discordId ?? `#${i}`),
        outcome: 'failed',
        error: parsed.error.issues.map((x) => x.message).join('; '),
      });
      continue;
    }
    const r = parsed.data;
    try {
      const res = await tx(async (t) => {
        const job = await resolveJob(t, { job: r.job, jobId: r.jobId } as { job?: string; jobId?: number });
        const x = await upsertBotMember(
          t,
          { discordId: r.discordId, ign: r.ign, jobId: job.id, nickname: r.nickname },
          { actorType: 'SYSTEM', via: 'bulk-import' },
        );
        if (opts.dryRun) throw new DryRun(x.created ? 'created' : x.changed ? 'updated' : 'unchanged');
        return x;
      });
      out.push({
        discordId: r.discordId,
        outcome: res.created ? 'created' : res.changed ? 'updated' : 'unchanged',
      });
    } catch (err) {
      if (err instanceof DryRun) out.push({ discordId: r.discordId, outcome: err.outcome });
      else {
        const msg = isUniqueViolation(err, ...IGN_INDEX)
          ? 'DUPLICATE_IGN'
          : ((err as { code?: string }).code ?? (err as Error).message);
        out.push({ discordId: r.discordId, outcome: 'failed', error: msg });
      }
    }
  }
  return out;
}

class DryRun extends Error {
  constructor(public outcome: 'created' | 'updated' | 'unchanged') {
    super('dry run');
  }
}
