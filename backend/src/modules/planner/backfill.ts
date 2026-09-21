import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { Env } from '../../config/env.js';
import type { Tx } from '../../lib/tx.js';
import { enqueueNotifications } from '../notifications/outbox.js';
import type { ReservePromotedPayload } from '../notifications/types.js';
import { bumpVersion } from './plan.js';

export type BackfillReason = 'UNREGISTERED' | 'LEAVE' | 'DEACTIVATED';

export type BackfillResult = {
  teamId: number;
  teamName: string;
  slot: number;
  vacatedMemberId: string;
  promotedMemberId: string;
  reason: BackfillReason;
};

/**
 * Auto-backfill (design 7.4, FR-5.11 to FR-5.20). Called with the Activity lock held (that lock is what makes
 * "exactly one promotion per vacated slot" true) and AFTER the caller changed the registration and ran waitlist
 * promotion, so promoted waitlisters are already eligible reserves.
 *
 * Callers decide the trigger: a placed member's registration went from JOINED to LEAVE/NONE, or the member was
 * deactivated. Manual admin unplacing/moving never calls this (FR-5.19), and a slot an admin left empty is never
 * filled (FR-5.20) because this only runs on a withdrawal.
 *
 *  - no placement: nothing to do (the member just leaves the reserve list);
 *  - autoBackfill OFF: the placement stays (flagged through regStatus) unless `removeWhenOff` (deactivation);
 *  - autoBackfill ON: the vacated placement is ALWAYS removed (FR-5.14). If the occurrence has started
 *    (checked DB-side after the lock wait, FR-5.18) or there is no eligible reserve, the slot stays empty;
 *    otherwise the first eligible reserve (JOINED, active, unplaced, by registeredAt then id) takes the exact
 *    vacated slot with source AUTO_BACKFILL and a reserve.promoted notification is enqueued in this transaction.
 * planVersion is bumped once when anything in the plan changed. Returns the new version in that case.
 */
export async function handleWithdrawal(
  tx: Tx,
  o: {
    occurrenceId: number;
    activityId: string;
    memberId: string;
    reason: BackfillReason;
    /** deactivation: a deactivated member's placement is removed even when auto-backfill is off */
    removeWhenOff?: boolean;
    notifications: Env['NOTIFICATIONS_PROVIDER'];
    requestId?: string;
  },
): Promise<{ backfilled: BackfillResult[]; version: number | null }> {
  const { occurrenceId, memberId, reason } = o;
  const audit = (action: string, meta: Record<string, unknown>, actorType: 'SYSTEM' = 'SYSTEM') =>
    record(tx, {
      actorType,
      action,
      entityType: 'occurrence',
      entityId: String(occurrenceId),
      meta: meta as never,
      requestId: o.requestId,
    });

  const [vacated] = await tx.$queryRaw<{ id: number; teamId: number; slot: number }[]>`
    SELECT id, "teamId", slot FROM "Placement" WHERE "occurrenceId" = ${occurrenceId} AND "memberId" = ${memberId}::uuid`;
  if (!vacated) return { backfilled: [], version: null };

  // Settings are read after the lock, so a concurrent autoBackfill switch is seen consistently.
  const [act] = await tx.$queryRaw<{ name: string; autoBackfill: boolean }[]>`
    SELECT name, "autoBackfill" FROM "Activity" WHERE id = ${o.activityId}`;
  if (!act!.autoBackfill && !o.removeWhenOff) return { backfilled: [], version: null };

  await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${vacated.id}`;
  const base = { memberId, reason, teamId: vacated.teamId, slot: vacated.slot };

  if (!act!.autoBackfill) {
    await audit('plan.vacated', { ...base, autoBackfill: false });
    return { backfilled: [], version: await bumpVersion(tx, occurrenceId) };
  }

  const [occ] = await tx.$queryRaw<{ started: boolean; startsAt: Date; date: string }[]>`
    SELECT "startsAt" <= clock_timestamp() AS started, "startsAt", to_char(date, 'YYYY-MM-DD') AS date
    FROM "Occurrence" WHERE id = ${occurrenceId}`;
  if (occ!.started) {
    await audit('plan.vacated', { ...base, afterStart: true });
    return { backfilled: [], version: await bumpVersion(tx, occurrenceId) };
  }

  const [reserve] = await tx.$queryRaw<{ memberId: string; ign: string; discordId: string }[]>`
    SELECT r."memberId", m.ign, m."discordId"
    FROM "Registration" r JOIN "Member" m ON m.id = r."memberId"
    WHERE r."occurrenceId" = ${occurrenceId} AND r.status = 'JOINED' AND m."isActive"
      AND NOT EXISTS (SELECT 1 FROM "Placement" p WHERE p."occurrenceId" = r."occurrenceId" AND p."memberId" = r."memberId")
    ORDER BY r."registeredAt", r.id
    LIMIT 1`;
  if (!reserve) {
    await audit('plan.vacated', { ...base, noReserve: true });
    return { backfilled: [], version: await bumpVersion(tx, occurrenceId) };
  }

  await tx.$executeRaw`
    INSERT INTO "Placement" ("occurrenceId", "memberId", "teamId", slot, source, "backfilledForMemberId", "backfillReason", "placedById")
    VALUES (${occurrenceId}, ${reserve.memberId}::uuid, ${vacated.teamId}, ${vacated.slot}, 'AUTO_BACKFILL',
            ${memberId}::uuid, ${reason}::"BackfillReason", NULL)`;
  const version = await bumpVersion(tx, occurrenceId);

  const [where] = await tx.$queryRaw<{ teamName: string; roomName: string }[]>`
    SELECT t.name AS "teamName", r.name AS "roomName" FROM "Team" t JOIN "Room" r ON r.id = t."roomId" WHERE t.id = ${vacated.teamId}`;
  const [vac] = await tx.$queryRaw<{ ign: string }[]>`SELECT ign FROM "Member" WHERE id = ${memberId}::uuid`;

  await audit('plan.backfill', {
    occurrenceId,
    vacatedMemberId: memberId,
    promotedMemberId: reserve.memberId,
    room: where!.roomName,
    teamId: vacated.teamId,
    team: where!.teamName,
    slot: vacated.slot,
    reason,
    planVersion: version,
  });
  const payload: ReservePromotedPayload = {
    occurrenceId,
    activityId: o.activityId,
    activityName: act!.name,
    date: occ!.date,
    startsAt: occ!.startsAt.toISOString(),
    roomName: where!.roomName,
    teamId: vacated.teamId,
    teamName: where!.teamName,
    slot: vacated.slot,
    promotedMemberId: reserve.memberId,
    promotedDiscordId: reserve.discordId,
    promotedIgn: reserve.ign,
    vacatedMemberId: memberId,
    vacatedIgn: vac!.ign,
    reason,
    planVersion: version,
  };
  // Same transaction, no savepoint, no network I/O: a failed enqueue rolls the whole promotion back.
  await enqueueNotifications(tx, o.notifications, 'reserve.promoted', payload);

  return {
    version,
    backfilled: [
      {
        teamId: vacated.teamId,
        teamName: where!.teamName,
        slot: vacated.slot,
        vacatedMemberId: memberId,
        promotedMemberId: reserve.memberId,
        reason,
      },
    ],
  };
}

/**
 * Undo of an auto-backfill (FR-5.17): removes the promoted member from the slot; they return to the reserves at
 * their original position because reserve order is derived from registeredAt. Still-PENDING outbox rows of that
 * promotion are cancelled (deleted; rows already SENDING/SENT are left alone). No message is sent on undo.
 * Caller holds the Activity lock and checked the version.
 */
export async function undoBackfill(
  tx: Tx,
  a: { occurrenceId: number; memberId: string; actor: { memberId: string }; requestId?: string },
): Promise<{ version: number; cancelledNotifications: number }> {
  const { occurrenceId, memberId } = a;
  const [p] = await tx.$queryRaw<
    { id: number; teamId: number; slot: number; source: string; vacated: string | null }[]
  >`
    SELECT id, "teamId", slot, source, "backfilledForMemberId" AS vacated FROM "Placement"
    WHERE "occurrenceId" = ${occurrenceId} AND "memberId" = ${memberId}::uuid`;
  if (!p) throw new AppError('NOT_FOUND', 404, 'The member has no placement in this occurrence');
  if (p.source !== 'AUTO_BACKFILL') {
    throw new AppError('NOT_AN_AUTO_BACKFILL', 409, 'Only an auto-backfilled placement can be undone');
  }
  await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${p.id}`;
  // Cancel the promotion's messages that have not started sending. dedupeKey: reserve.promoted:{occ}:{member}:{version}:{dm|channel}
  const cancelled = await tx.$queryRaw<{ id: number }[]>`
    DELETE FROM "NotificationOutbox"
    WHERE status = 'PENDING' AND "entityType" = 'occurrence' AND "entityId" = ${String(occurrenceId)}
      AND "dedupeKey" LIKE ${`reserve.promoted:${occurrenceId}:${memberId}:%`}
    RETURNING id`;
  const version = await bumpVersion(tx, occurrenceId);
  await record(tx, {
    actorType: 'MEMBER',
    actorId: a.actor.memberId,
    action: 'plan.backfill.undo',
    entityType: 'occurrence',
    entityId: String(occurrenceId),
    meta: {
      memberId,
      teamId: p.teamId,
      slot: p.slot,
      vacatedMemberId: p.vacated,
      cancelledNotifications: cancelled.map((c) => c.id),
    } as never,
    requestId: a.requestId,
  });
  return { version, cancelledNotifications: cancelled.length };
}
