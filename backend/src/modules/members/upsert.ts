import type { Job, Member } from '@prisma/client';
import { record } from '../../lib/audit.js';
import { errors } from '../../lib/errors.js';
import type { Tx } from '../../lib/tx.js';

export type UpsertInput = {
  discordId: string;
  ign: string;
  jobId: number;
  /** undefined = not sent (kept as is); null = clear. */
  nickname?: string | null;
};
export type UpsertCtx = { actorType: 'BOT' | 'SYSTEM'; requestId?: string; via: string };
export type MemberWithJob = Member & { job: Job };

export async function resolveJob(tx: Tx, ref: { job?: string; jobId?: number }): Promise<Job> {
  const row = await tx.job.findUnique({
    where: ref.jobId !== undefined ? { id: ref.jobId } : { label: ref.job ?? '' },
  });
  if (!row) throw errors.invalidJob();
  return row;
}

type Change = { from: unknown; to: unknown };
export function diff<T extends Record<string, unknown>>(before: T, after: T, fields: (keyof T & string)[]) {
  const changes: Record<string, Change> = {};
  for (const f of fields)
    if (before[f] !== after[f]) changes[f] = { from: before[f] ?? null, to: after[f] ?? null };
  return changes;
}

/**
 * Idempotent bot-style upsert. The bot is authoritative for the fields it sends (IGN, job, and nickname
 * only when included) and reactivates a deactivated member (IGN uniqueness is enforced by the index and
 * surfaces as a unique violation, mapped to DUPLICATE_IGN by callers/the error handler).
 * DO UPDATE only fires when something actually changes, so a repeat writes no audit row.
 * Audit rows record before/after values of the changed fields so disputes can be traced.
 */
export async function upsertBotMember(tx: Tx, input: UpsertInput, ctx: UpsertCtx) {
  const { discordId, ign, jobId } = input;
  const hasNick = input.nickname !== undefined;

  // Pre-image (row locked so before/after are consistent for an existing member).
  const beforeRows = await tx.$queryRaw<Pick<Member, 'ign' | 'nickname' | 'jobId' | 'isActive'>[]>`
    SELECT ign, nickname, "jobId", "isActive" FROM "Member" WHERE "discordId" = ${discordId} FOR UPDATE`;
  const before = beforeRows[0] ?? null;

  const rows = await tx.$queryRaw<{ id: string; inserted: boolean }[]>`
    INSERT INTO "Member" (id, "discordId", ign, nickname, "jobId", "isActive", source, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${discordId}, ${ign}, ${input.nickname ?? null}::text, ${jobId}::int, true,
            'BOT', clock_timestamp(), clock_timestamp())
    ON CONFLICT ("discordId") DO UPDATE SET
      ign = EXCLUDED.ign,
      "jobId" = EXCLUDED."jobId",
      nickname = CASE WHEN ${hasNick}::boolean THEN EXCLUDED.nickname ELSE "Member".nickname END,
      "isActive" = true,
      "deactivatedAt" = NULL,
      "updatedAt" = clock_timestamp()
    WHERE "Member".ign IS DISTINCT FROM EXCLUDED.ign
       OR "Member"."jobId" IS DISTINCT FROM EXCLUDED."jobId"
       OR NOT "Member"."isActive"
       OR (${hasNick}::boolean AND "Member".nickname IS DISTINCT FROM EXCLUDED.nickname)
    RETURNING id, (xmax = 0) AS inserted`;
  const changed = rows[0];
  const member = await tx.member.findUniqueOrThrow({
    where: changed ? { id: changed.id } : { discordId },
    include: { job: true },
  });
  if (changed) {
    const fields = ['ign', 'nickname', 'jobId', 'isActive'] as const;
    await record(tx, {
      actorType: ctx.actorType,
      action: changed.inserted ? 'member.create' : 'member.update',
      entityType: 'member',
      entityId: member.id,
      meta: {
        via: ctx.via,
        ...(changed.inserted
          ? { created: { ign: member.ign, nickname: member.nickname, jobId: member.jobId } }
          : {
              changes: diff(before ?? { ign: null, nickname: null, jobId: null, isActive: null }, member, [
                ...fields,
              ]),
            }),
      } as never,
      requestId: ctx.requestId,
    });
  }
  return { member: member as MemberWithJob, created: changed?.inserted ?? false, changed: !!changed };
}
