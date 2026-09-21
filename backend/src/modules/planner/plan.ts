import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { OccurrenceRow } from '../../lib/occurrence.js';
import type { Tx } from '../../lib/tx.js';

type Db = Pick<Tx, '$queryRaw'>;

export type PlanOut = {
  eventId: string;
  date: string;
  startsAt: string | null;
  version: number;
  autoBackfill: boolean;
  rooms: {
    id: number;
    key: string;
    name: string;
    archived: boolean;
    /** sum of non-archived team sizes */
    capacity: number;
    teams: {
      id: number;
      name: string;
      size: number;
      archived: boolean;
      placements: {
        memberId: string;
        slot: number;
        /** JOINED | WAITLISTED | LEAVE | NONE. The UI labels LEAVE/NONE "withdrawn" and others "not registered". */
        regStatus: 'JOINED' | 'WAITLISTED' | 'LEAVE' | 'NONE';
        source: 'ADMIN' | 'COPY' | 'AUTO_BACKFILL';
        backfill?: { vacatedMemberId: string | null; reason: string | null; at: string };
      }[];
    }[];
  }[];
  /** every JOINED, active, unplaced member ordered by (registeredAt, id) */
  reserves: { memberId: string; registeredAt: string; order: number }[];
};

/**
 * Reads the plan of an occurrence. Never creates rows: a missing occurrence (occ = null) yields version 0,
 * the layout and no placements or reserves. Archived rooms/teams are included only when they hold placements
 * in this occurrence, so past plans still render.
 */
export async function buildPlan(
  db: Db,
  activityId: string,
  eventId: string,
  date: string,
  occ: OccurrenceRow | null,
): Promise<PlanOut> {
  const [act] = await db.$queryRaw<
    { autoBackfill: boolean }[]
  >`SELECT "autoBackfill" FROM "Activity" WHERE id = ${activityId}`;
  const layout = await db.$queryRaw<
    {
      rid: number;
      key: string;
      rname: string;
      rarch: Date | null;
      tid: number | null;
      tname: string | null;
      size: number | null;
      tarch: Date | null;
    }[]
  >`
    SELECT r.id AS rid, r.key, r.name AS rname, r."archivedAt" AS rarch,
           t.id AS tid, t.name AS tname, t.size, t."archivedAt" AS tarch
    FROM "Room" r LEFT JOIN "Team" t ON t."roomId" = r.id
    WHERE r."activityId" = ${activityId}
    ORDER BY r."sortOrder", r.id, t."sortOrder", t.id`;
  const placements = occ
    ? await db.$queryRaw<
        {
          memberId: string;
          teamId: number;
          slot: number;
          source: 'ADMIN' | 'COPY' | 'AUTO_BACKFILL';
          backfilledForMemberId: string | null;
          backfillReason: string | null;
          placedAt: Date;
          regStatus: 'JOINED' | 'WAITLISTED' | 'LEAVE' | null;
        }[]
      >`
        SELECT p."memberId", p."teamId", p.slot, p.source, p."backfilledForMemberId", p."backfillReason", p."placedAt",
               r.status AS "regStatus"
        FROM "Placement" p
        LEFT JOIN "Registration" r ON r."occurrenceId" = p."occurrenceId" AND r."memberId" = p."memberId"
        WHERE p."occurrenceId" = ${occ.id}
        ORDER BY p."teamId", p.slot`
    : [];
  const reserves = occ
    ? await db.$queryRaw<{ memberId: string; registeredAt: Date }[]>`
        SELECT r."memberId", r."registeredAt"
        FROM "Registration" r JOIN "Member" m ON m.id = r."memberId" AND m."isActive"
        WHERE r."occurrenceId" = ${occ.id} AND r.status = 'JOINED'
          AND NOT EXISTS (SELECT 1 FROM "Placement" p WHERE p."occurrenceId" = r."occurrenceId" AND p."memberId" = r."memberId")
        ORDER BY r."registeredAt", r.id`
    : [];

  const byTeam = new Map<number, PlanOut['rooms'][number]['teams'][number]['placements']>();
  for (const p of placements) {
    const list = byTeam.get(p.teamId) ?? [];
    list.push({
      memberId: p.memberId,
      slot: p.slot,
      regStatus: p.regStatus ?? 'NONE',
      source: p.source,
      ...(p.source === 'AUTO_BACKFILL'
        ? {
            backfill: {
              vacatedMemberId: p.backfilledForMemberId,
              reason: p.backfillReason,
              at: p.placedAt.toISOString(),
            },
          }
        : {}),
    });
    byTeam.set(p.teamId, list);
  }
  const rooms = new Map<number, PlanOut['rooms'][number]>();
  for (const x of layout) {
    const held = x.tid !== null && byTeam.has(x.tid);
    let room = rooms.get(x.rid);
    if (!room)
      rooms.set(
        x.rid,
        (room = { id: x.rid, key: x.key, name: x.rname, archived: x.rarch !== null, capacity: 0, teams: [] }),
      );
    if (x.tid === null) continue;
    if (x.tarch !== null && !held) continue;
    room.teams.push({
      id: x.tid,
      name: x.tname!,
      size: x.size!,
      archived: x.tarch !== null,
      placements: byTeam.get(x.tid) ?? [],
    });
    if (x.tarch === null) room.capacity += x.size!;
  }
  return {
    eventId,
    date,
    startsAt: occ ? occ.startsAt.toISOString() : null,
    version: occ?.planVersion ?? 0,
    autoBackfill: act!.autoBackfill,
    // archived rooms appear only while some team of theirs still holds placements here
    rooms: [...rooms.values()].filter((r) => !r.archived || r.teams.some((t) => t.placements.length > 0)),
    reserves: reserves.map((r, i) => ({
      memberId: r.memberId,
      registeredAt: r.registeredAt.toISOString(),
      order: i + 1,
    })),
  };
}

/** FR-5.8: last write wins with a version check. Called under the Activity lock. */
export async function assertVersion(tx: Tx, occ: OccurrenceRow, expected: number, date: string) {
  if (occ.planVersion === expected) return;
  const plan = await buildPlan(tx, occ.activityId, occ.eventId, date, occ);
  throw new AppError('PLAN_VERSION_CONFLICT', 409, 'The plan changed since you loaded it', {
    currentVersion: occ.planVersion,
    plan,
  });
}

export async function bumpVersion(tx: Tx, occurrenceId: number): Promise<number> {
  const [r] = await tx.$queryRaw<{ v: number }[]>`
    UPDATE "Occurrence" SET "planVersion" = "planVersion" + 1 WHERE id = ${occurrenceId} RETURNING "planVersion" AS v`;
  return r!.v;
}

type Cur = { id: number; teamId: number; slot: number };

/**
 * Places, moves or unplaces one member (design 6.5). Caller holds the Activity lock, created the occurrence and
 * checked the version. Slot omitted = lowest free slot (no-op if already in that team). An occupied target slot
 * swaps in one transaction. Removing a member by hand never triggers backfill (FR-5.19).
 * Returns the resulting version and whether anything changed (no change = no version bump).
 */
export async function placeMember(
  tx: Tx,
  a: {
    occ: OccurrenceRow;
    memberId: string;
    teamId: number | null;
    slot?: number;
    actor: { memberId: string };
    requestId?: string;
  },
): Promise<{ version: number; changed: boolean }> {
  const { occ, memberId, teamId, actor } = a;
  const [cur] = await tx.$queryRaw<Cur[]>`
    SELECT id, "teamId", slot FROM "Placement" WHERE "occurrenceId" = ${occ.id} AND "memberId" = ${memberId}::uuid`;
  const audit = (action: string, meta: Record<string, unknown>) =>
    record(tx, {
      actorType: 'MEMBER',
      actorId: actor.memberId,
      action,
      entityType: 'occurrence',
      entityId: String(occ.id),
      meta: meta as never,
      requestId: a.requestId,
    });

  if (teamId === null) {
    if (!cur) return { version: occ.planVersion, changed: false };
    await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${cur.id}`;
    await audit('plan.unplace', { memberId, from: { teamId: cur.teamId, slot: cur.slot } });
    return { version: await bumpVersion(tx, occ.id), changed: true };
  }

  const [team] = await tx.$queryRaw<
    { size: number; archivedAt: Date | null; roomArchivedAt: Date | null; activityId: string }[]
  >`
    SELECT t.size, t."archivedAt", r."archivedAt" AS "roomArchivedAt", r."activityId"
    FROM "Team" t JOIN "Room" r ON r.id = t."roomId" WHERE t.id = ${teamId}`;
  if (!team || team.archivedAt || team.roomArchivedAt) throw new AppError('NOT_FOUND', 404, 'Team not found');
  if (team.activityId !== occ.activityId)
    throw new AppError('TEAM_NOT_IN_ACTIVITY', 422, 'The team belongs to another activity');
  if (a.slot !== undefined && (a.slot < 1 || a.slot > team.size)) {
    throw new AppError('SLOT_OUT_OF_RANGE', 422, `Slot must be between 1 and ${team.size}`, {
      size: team.size,
    });
  }

  const [m] = await tx.$queryRaw<
    { isActive: boolean }[]
  >`SELECT "isActive" FROM "Member" WHERE id = ${memberId}::uuid`;
  if (!m) throw new AppError('MEMBER_NOT_FOUND', 404, 'Member not found');
  if (!m.isActive) throw new AppError('MEMBER_INACTIVE', 422, 'Member is deactivated');

  let slot = a.slot;
  if (slot === undefined) {
    if (cur && cur.teamId === teamId) return { version: occ.planVersion, changed: false };
    const free = await tx.$queryRaw<{ s: number }[]>`
      SELECT s FROM generate_series(1, ${team.size}::int) s
      WHERE NOT EXISTS (SELECT 1 FROM "Placement" p WHERE p."occurrenceId" = ${occ.id} AND p."teamId" = ${teamId} AND p.slot = s)
      ORDER BY s LIMIT 1`;
    if (!free[0]) throw new AppError('TEAM_FULL', 409, 'The team is full', { teamId, size: team.size });
    slot = free[0].s;
  }
  if (cur && cur.teamId === teamId && cur.slot === slot) return { version: occ.planVersion, changed: false };

  const [occupant] = await tx.$queryRaw<{ id: number; memberId: string }[]>`
    SELECT id, "memberId" FROM "Placement" WHERE "occurrenceId" = ${occ.id} AND "teamId" = ${teamId} AND slot = ${slot}`;

  // Swap or move: delete both rows, then insert fresh ones (the unique slot index forbids an in-place swap).
  if (cur) await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${cur.id}`;
  if (occupant) await tx.$executeRaw`DELETE FROM "Placement" WHERE id = ${occupant.id}`;
  await tx.$executeRaw`
    INSERT INTO "Placement" ("occurrenceId", "memberId", "teamId", slot, source, "placedById")
    VALUES (${occ.id}, ${memberId}::uuid, ${teamId}, ${slot}, 'ADMIN', ${actor.memberId}::uuid)`;
  if (occupant && cur) {
    // the occupant takes the mover's old slot
    await tx.$executeRaw`
      INSERT INTO "Placement" ("occurrenceId", "memberId", "teamId", slot, source, "placedById")
      VALUES (${occ.id}, ${occupant.memberId}::uuid, ${cur.teamId}, ${cur.slot}, 'ADMIN', ${actor.memberId}::uuid)`;
  }
  await audit(cur ? 'plan.move' : 'plan.place', {
    memberId,
    from: cur ? { teamId: cur.teamId, slot: cur.slot } : null,
    to: { teamId, slot },
    ...(occupant ? { swappedWith: occupant.memberId, occupantUnplaced: !cur } : {}),
  });
  return { version: await bumpVersion(tx, occ.id), changed: true };
}

/** Removes every placement of the occurrence (no backfill). No change = no version bump. */
export async function clearPlan(tx: Tx, occ: OccurrenceRow, actor: { memberId: string }, requestId?: string) {
  const removed = await tx.$executeRaw`DELETE FROM "Placement" WHERE "occurrenceId" = ${occ.id}`;
  if (removed === 0) return { version: occ.planVersion, removed: 0 };
  await record(tx, {
    actorType: 'MEMBER',
    actorId: actor.memberId,
    action: 'plan.clear',
    entityType: 'occurrence',
    entityId: String(occ.id),
    meta: { removed },
    requestId,
  });
  return { version: await bumpVersion(tx, occ.id), removed };
}
