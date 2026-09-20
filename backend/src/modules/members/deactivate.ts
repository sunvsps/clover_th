import { record } from '../../lib/audit.js';
import { lockActivities } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';
import { promoteWaitlist } from '../registrations/service.js';

type Actor = { type: 'BOT' | 'MEMBER'; id?: string | null };

/**
 * Deactivation (design 7.6), one transaction:
 *  1. lock all activities in id order, then set isActive=false;
 *  2. delete queue entries; 3. delete sessions;
 *  4. for each not-yet-started occurrence where the member has a registration or placement, delete both,
 *     bump planVersion when a placement went, and run waitlist promotion (capacity freed by a JOINED row);
 *  5. audit each step. History (past registrations, awards, audit rows) is kept.
 * Backfill (reason DEACTIVATED) for auto-backfill activities is wired in WP7b at the marked hook.
 * Idempotent: returns false, changing nothing, when the member is already inactive.
 */
export async function deactivateMember(
  tx: Tx,
  memberId: string,
  actor: Actor,
  requestId?: string,
): Promise<boolean> {
  await lockActivities(tx);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Member" SET "isActive" = false, "deactivatedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
    WHERE id = ${memberId}::uuid AND "isActive" RETURNING id`;
  if (rows.length === 0) return false;

  const audit = (action: string, entityType: string, entityId: string, meta?: Record<string, unknown>) =>
    record(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action,
      entityType,
      entityId,
      meta: meta as never,
      requestId,
    });

  await audit('member.deactivate', 'member', memberId);

  const q = await tx.queueEntry.deleteMany({ where: { memberId } });
  if (q.count > 0)
    await audit('queue.remove', 'member', memberId, { entries: q.count, reason: 'DEACTIVATED' });
  const s = await tx.session.deleteMany({ where: { memberId } });
  if (s.count > 0)
    await audit('session.revoke', 'member', memberId, { sessions: s.count, reason: 'DEACTIVATED' });

  const affected = await tx.$queryRaw<
    { occurrenceId: number; capacity: number | null; regStatus: string | null; placementId: number | null }[]
  >`
    SELECT o.id AS "occurrenceId", a."registrationCapacity" AS capacity, r.status AS "regStatus", p.id AS "placementId"
    FROM "Occurrence" o
    JOIN "ScheduleEvent" e ON e.id = o."eventId"
    JOIN "Activity" a ON a.id = e."activityId"
    LEFT JOIN "Registration" r ON r."occurrenceId" = o.id AND r."memberId" = ${memberId}::uuid
    LEFT JOIN "Placement" p ON p."occurrenceId" = o.id AND p."memberId" = ${memberId}::uuid
    WHERE o."startsAt" > clock_timestamp() AND (r.id IS NOT NULL OR p.id IS NOT NULL)
    ORDER BY o.id`;

  for (const o of affected) {
    if (o.placementId !== null) {
      await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${o.placementId}`;
      await tx.$executeRaw`UPDATE "Occurrence" SET "planVersion" = "planVersion" + 1 WHERE id = ${o.occurrenceId}`;
      await audit('placement.remove', 'occurrence', String(o.occurrenceId), {
        memberId,
        reason: 'DEACTIVATED',
      });
      // WP7b hook: auto-backfill of the vacated slot (reason DEACTIVATED) runs here for autoBackfill activities.
    }
    if (o.regStatus !== null) {
      await tx.$executeRaw`DELETE FROM "Registration" WHERE "occurrenceId" = ${o.occurrenceId} AND "memberId" = ${memberId}::uuid`;
      await audit('registration.remove', 'occurrence', String(o.occurrenceId), {
        memberId,
        from: o.regStatus,
        reason: 'DEACTIVATED',
      });
      if (o.regStatus === 'JOINED') {
        for (const pm of await promoteWaitlist(tx, o.occurrenceId, o.capacity)) {
          await record(tx, {
            actorType: 'SYSTEM',
            action: 'registration.promote',
            entityType: 'occurrence',
            entityId: String(o.occurrenceId),
            meta: { memberId: pm, reason: 'DEACTIVATED', triggeredBy: memberId },
            requestId,
          });
        }
      }
    }
  }
  return true;
}
