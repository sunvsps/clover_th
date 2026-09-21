import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { readOccurrence, type OccurrenceRow } from '../../lib/occurrence.js';
import { addDays, dayOfWeekOf, isValidDateStr } from '../../lib/time.js';
import type { Tx } from '../../lib/tx.js';
import { bumpVersion } from './plan.js';

export type SkipReason = 'MEMBER_INACTIVE' | 'TEAM_REMOVED' | 'SLOT_OUT_OF_RANGE';

/**
 * Copy-from-previous (FR-5.7, deviation 13). Same event one week earlier, or `sourceDate` (same weekday).
 * Copies every member whose account is active, including members no longer JOINED (they show up flagged through
 * regStatus in the plan, not dropped). Skips deactivated members and teams/slots that no longer exist.
 * Rejected with PLAN_NOT_EMPTY unless the target plan is empty; the admin calls clear first.
 * Caller holds the Activity lock and checked the version.
 */
export async function copyFromPrevious(
  tx: Tx,
  a: {
    occ: OccurrenceRow;
    date: string;
    sourceDate?: string;
    actor: { memberId: string };
    requestId?: string;
  },
) {
  const { occ, date } = a;
  const sourceDate = a.sourceDate ?? addDays(date, -7);
  if (!isValidDateStr(sourceDate) || dayOfWeekOf(sourceDate) !== dayOfWeekOf(date) || sourceDate === date) {
    throw new AppError(
      'INVALID_OCCURRENCE_DATE',
      422,
      'sourceDate must be a different date with the same weekday',
    );
  }
  const [cnt] = await tx.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM "Placement" WHERE "occurrenceId" = ${occ.id}`;
  if (cnt!.n > 0) throw new AppError('PLAN_NOT_EMPTY', 409, 'The target plan is not empty; clear it first');

  const src = await readOccurrence(tx, occ.eventId, sourceDate);
  if (!src)
    return {
      copied: 0,
      skipped: [] as { memberId: string; reason: SkipReason }[],
      version: occ.planVersion,
      sourceDate,
    };

  const rows = await tx.$queryRaw<
    { memberId: string; teamId: number; slot: number; reason: SkipReason | null }[]
  >`
    SELECT p."memberId", p."teamId", p.slot,
           CASE WHEN NOT m."isActive" THEN 'MEMBER_INACTIVE'
                WHEN t.id IS NULL OR t."archivedAt" IS NOT NULL OR r."archivedAt" IS NOT NULL OR r."activityId" <> ${occ.activityId}
                  THEN 'TEAM_REMOVED'
                WHEN p.slot > t.size THEN 'SLOT_OUT_OF_RANGE' END AS reason
    FROM "Placement" p
    JOIN "Member" m ON m.id = p."memberId"
    LEFT JOIN "Team" t ON t.id = p."teamId"
    LEFT JOIN "Room" r ON r.id = t."roomId"
    WHERE p."occurrenceId" = ${src.id}
    ORDER BY p."teamId", p.slot`;
  const skipped = rows.filter((r) => r.reason).map((r) => ({ memberId: r.memberId, reason: r.reason! }));
  const ok = rows.filter((r) => !r.reason);
  for (const r of ok) {
    await tx.$executeRaw`
      INSERT INTO "Placement" ("occurrenceId", "memberId", "teamId", slot, source, "placedById")
      VALUES (${occ.id}, ${r.memberId}::uuid, ${r.teamId}, ${r.slot}, 'COPY', ${a.actor.memberId}::uuid)`;
  }
  let version = occ.planVersion;
  if (ok.length > 0) {
    version = await bumpVersion(tx, occ.id);
    await record(tx, {
      actorType: 'MEMBER',
      actorId: a.actor.memberId,
      action: 'plan.copy',
      entityType: 'occurrence',
      entityId: String(occ.id),
      meta: { sourceDate, copied: ok.length, skipped: skipped.length },
      requestId: a.requestId,
    });
  }
  return { copied: ok.length, skipped, version, sourceDate };
}
