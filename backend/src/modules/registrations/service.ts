import type { Env } from '../../config/env.js';
import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { OccurrenceRow } from '../../lib/occurrence.js';
import type { Tx } from '../../lib/tx.js';
import { handleWithdrawal, type BackfillResult } from '../planner/backfill.js';

export type RegStatus = 'JOINED' | 'WAITLISTED' | 'LEAVE';
export type Requested = 'JOINED' | 'LEAVE' | 'NONE';
export type Actor = { memberId: string; isAdmin: boolean };

export type SetResult = {
  status: RegStatus | 'NONE';
  waitlistPosition: number | null;
  promoted: string[];
  /** Planner auto-backfills triggered by this change (empty when none). */
  backfilled: BackfillResult[];
  planVersion: number;
};

type RegRow = { id: number; status: RegStatus };

/**
 * Promotes the oldest WAITLISTED registrations (by registeredAt, id) into free JOINED capacity, in ONE
 * statement. registeredAt is kept (deviation 3). The Activity lock must be held by the caller, which is
 * what makes promotion exactly-once. Returns promoted member ids in promotion order.
 */
export async function promoteWaitlist(
  tx: Tx,
  occurrenceId: number,
  capacity: number | null,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ memberId: string; registeredAt: Date; id: number }[]>`
    UPDATE "Registration" SET status = 'JOINED', "updatedById" = NULL
    WHERE id IN (
      SELECT id FROM "Registration"
      WHERE "occurrenceId" = ${occurrenceId} AND status = 'WAITLISTED'
      ORDER BY "registeredAt", id
      LIMIT CASE WHEN ${capacity}::int IS NULL THEN NULL  -- no capacity: everyone waitlisted gets in
                 ELSE GREATEST(${capacity}::int - (SELECT count(*)::int FROM "Registration"
                                                    WHERE "occurrenceId" = ${occurrenceId} AND status = 'JOINED'), 0) END)
    RETURNING "memberId", "registeredAt", id`;
  return rows
    .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime() || a.id - b.id)
    .map((r) => r.memberId);
}

export async function waitlistPosition(tx: Tx, occurrenceId: number, regId: number): Promise<number> {
  const r = await tx.$queryRaw<{ pos: number }[]>`
    SELECT count(*)::int + 1 AS pos FROM "Registration" o, "Registration" me
    WHERE me.id = ${regId} AND o."occurrenceId" = ${occurrenceId} AND o.status = 'WAITLISTED'
      AND (o."registeredAt", o.id) < (me."registeredAt", me.id)`;
  return r[0]!.pos;
}

/**
 * Changes one member's registration for an occurrence (design 7.3). Caller holds the Activity lock and
 * has get-or-created the occurrence. Order: status change, then waitlist promotion, (then backfill, WP7b).
 */
export async function setRegistration(
  tx: Tx,
  a: {
    occurrence: OccurrenceRow;
    memberId: string;
    requested: Requested;
    actor: Actor;
    requestId?: string;
    /** NOTIFICATIONS_PROVIDER: enqueue of reserve.promoted happens in this transaction unless 'off' */
    notifications?: Env['NOTIFICATIONS_PROVIDER'];
  },
): Promise<SetResult> {
  const { occurrence: occ, memberId, requested, actor } = a;

  // Settings are read AFTER the lock, so they cannot be stale.
  const [act] = await tx.$queryRaw<{ registrationCapacity: number | null }[]>`
    SELECT "registrationCapacity" FROM "Activity" WHERE id = ${occ.activityId}`;
  const capacity = act!.registrationCapacity;

  const [m] = await tx.$queryRaw<
    { isActive: boolean }[]
  >`SELECT "isActive" FROM "Member" WHERE id = ${memberId}::uuid`;
  if (!m) throw new AppError('MEMBER_NOT_FOUND', 404, 'Member not found');
  if (!m.isActive) throw new AppError('MEMBER_INACTIVE', 422, 'Member is deactivated');

  // Time is compared DB-side inside the transaction, after the lock wait (already evaluated by readOccurrence).
  if (!actor.isAdmin && occ.started)
    throw new AppError('REGISTRATION_CLOSED', 409, 'The occurrence has already started');

  const [cur] = await tx.$queryRaw<RegRow[]>`
    SELECT id, status FROM "Registration" WHERE "occurrenceId" = ${occ.id} AND "memberId" = ${memberId}::uuid`;
  const from: RegStatus | 'NONE' = cur?.status ?? 'NONE';
  const updatedBy = actor.memberId;
  let promoted: string[] = [];
  let backfilled: BackfillResult[] = [];
  let planVersion = occ.planVersion;
  let regId = cur?.id ?? null;

  const view = async (status: SetResult['status']): Promise<SetResult> => ({
    status,
    waitlistPosition:
      status === 'WAITLISTED' && regId !== null ? await waitlistPosition(tx, occ.id, regId) : null,
    promoted,
    backfilled,
    planVersion,
  });

  if (requested === 'JOINED') {
    if (from === 'JOINED' || from === 'WAITLISTED') return view(from); // no-op: keeps registeredAt
    const [jc] = await tx.$queryRaw<{ joined: number }[]>`
      SELECT count(*)::int AS joined FROM "Registration" WHERE "occurrenceId" = ${occ.id} AND status = 'JOINED'`;
    const to: RegStatus = capacity === null || jc!.joined < capacity ? 'JOINED' : 'WAITLISTED';
    // LEAVE or none -> JOINED/WAITLISTED resets registeredAt.
    const rows = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "Registration" ("occurrenceId", "memberId", status, "registeredAt", "updatedById")
      VALUES (${occ.id}, ${memberId}::uuid, ${to}::"RegistrationStatus", clock_timestamp(), ${updatedBy}::uuid)
      ON CONFLICT ("occurrenceId", "memberId")
      DO UPDATE SET status = EXCLUDED.status, "registeredAt" = clock_timestamp(), "updatedById" = EXCLUDED."updatedById"
      RETURNING id`;
    regId = rows[0]!.id;
    await audit(tx, a, from, to);
    return view(to);
  }

  if (requested === 'LEAVE') {
    if (from === 'LEAVE') return view('LEAVE');
    if (from === 'NONE') {
      const rows = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO "Registration" ("occurrenceId", "memberId", status, "registeredAt", "updatedById")
        VALUES (${occ.id}, ${memberId}::uuid, 'LEAVE', clock_timestamp(), ${updatedBy}::uuid) RETURNING id`;
      regId = rows[0]!.id;
    } else {
      await tx.$executeRaw`
        UPDATE "Registration" SET status = 'LEAVE', "updatedById" = ${updatedBy}::uuid WHERE id = ${cur!.id}`;
    }
  } else {
    // NONE = deletion; the audit row preserves the history.
    if (from === 'NONE') return view('NONE');
    await tx.$executeRaw`DELETE FROM "Registration" WHERE id = ${cur!.id}`;
    regId = null;
  }

  // A waitlisted member leaving frees nothing; only a JOINED member frees capacity.
  if (from === 'JOINED') {
    promoted = await promoteWaitlist(tx, occ.id, capacity);
    for (const pm of promoted) {
      await record(tx, {
        actorType: 'SYSTEM',
        action: 'registration.promote',
        entityType: 'occurrence',
        entityId: String(occ.id),
        meta: { memberId: pm, reason: 'CAPACITY_FREED', triggeredBy: memberId },
        requestId: a.requestId,
      });
    }
    // Order inside one transaction: status change, waitlist promotion, then backfill (design 7.3/7.4).
    // The trigger is a real transition out of JOINED; the routine itself finds out whether a placement exists.
    const bf = await handleWithdrawal(tx, {
      occurrenceId: occ.id,
      activityId: occ.activityId,
      memberId,
      reason: requested === 'NONE' ? 'UNREGISTERED' : 'LEAVE',
      notifications: a.notifications ?? 'off',
      requestId: a.requestId,
    });
    backfilled = bf.backfilled;
    if (bf.version !== null) planVersion = bf.version;
  }
  await audit(tx, a, from, requested === 'NONE' ? 'NONE' : 'LEAVE');
  return view(requested === 'NONE' ? 'NONE' : 'LEAVE');
}

async function audit(
  tx: Tx,
  a: { occurrence: OccurrenceRow; memberId: string; actor: Actor; requestId?: string },
  from: string,
  to: string,
) {
  await record(tx, {
    actorType: 'MEMBER',
    actorId: a.actor.memberId,
    action: 'registration.set',
    entityType: 'occurrence',
    entityId: String(a.occurrence.id),
    meta: { memberId: a.memberId, from, to },
    requestId: a.requestId,
  });
}
