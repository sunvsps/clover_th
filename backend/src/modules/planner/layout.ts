import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { withActivityLock } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';

export type LayoutTeamIn = { id?: number; name: string; size: number };
export type LayoutRoomIn = { id?: number; key: string; name: string; teams: LayoutTeamIn[] };

export type LayoutOut = {
  activityId: string;
  rooms: {
    id: number;
    key: string;
    name: string;
    sortOrder: number;
    /** sum of non-archived team sizes, computed, never stored */
    capacity: number;
    teams: { id: number; name: string; size: number; sortOrder: number }[];
  }[];
};

type Db = Pick<Tx, '$queryRaw'>;

export async function assertPlanner(db: Db, activityId: string) {
  const [a] = await db.$queryRaw<
    { hasPlanner: boolean }[]
  >`SELECT "hasPlanner" FROM "Activity" WHERE id = ${activityId}`;
  if (!a) throw new AppError('NOT_FOUND', 404, 'Activity not found');
  if (!a.hasPlanner) throw new AppError('ACTIVITY_HAS_NO_PLANNER', 404, 'This activity has no planner');
}

/** Live (non-archived) layout. */
export async function readLayout(db: Db, activityId: string): Promise<LayoutOut> {
  const rows = await db.$queryRaw<
    {
      rid: number;
      key: string;
      rname: string;
      rso: number;
      tid: number | null;
      tname: string | null;
      size: number | null;
      tso: number | null;
    }[]
  >`
    SELECT r.id AS rid, r.key, r.name AS rname, r."sortOrder" AS rso,
           t.id AS tid, t.name AS tname, t.size, t."sortOrder" AS tso
    FROM "Room" r LEFT JOIN "Team" t ON t."roomId" = r.id AND t."archivedAt" IS NULL
    WHERE r."activityId" = ${activityId} AND r."archivedAt" IS NULL
    ORDER BY r."sortOrder", r.id, t."sortOrder", t.id`;
  const rooms = new Map<number, LayoutOut['rooms'][number]>();
  for (const x of rows) {
    let room = rooms.get(x.rid);
    if (!room)
      rooms.set(
        x.rid,
        (room = { id: x.rid, key: x.key, name: x.rname, sortOrder: x.rso, capacity: 0, teams: [] }),
      );
    if (x.tid !== null) {
      room.teams.push({ id: x.tid, name: x.tname!, size: x.size!, sortOrder: x.tso! });
      room.capacity += x.size!;
    }
  }
  return { activityId, rooms: [...rooms.values()] };
}

type Violation = { teamId: number; placed: number; size: number };

/**
 * Replaces the layout (design 7.5). Runs under the Activity lock, which also serializes every placement and
 * registration write of the activity, including ones that would lazily create an occurrence.
 * Rejects LAYOUT_BELOW_PLACED when, in a NOT-yet-started occurrence, a team would disappear while holding a
 * placement or a placed member's slot would exceed the new team size (`placed` = highest occupied slot).
 * Teams and rooms with any placement (even past ones) are archived, never deleted. Unstarted occurrences of the
 * activity get planVersion + 1 so stale plan editors are told to reload.
 */
export async function replaceLayout(
  tx: Tx,
  activityId: string,
  input: LayoutRoomIn[],
  actor: { memberId: string },
  requestId?: string,
): Promise<LayoutOut> {
  await withActivityLock(tx, activityId);
  await assertPlanner(tx, activityId);

  const liveRooms = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "Room" WHERE "activityId" = ${activityId} AND "archivedAt" IS NULL`;
  const liveTeams = await tx.$queryRaw<{ id: number; roomId: number; hasPlacements: boolean }[]>`
    SELECT t.id, t."roomId", EXISTS (SELECT 1 FROM "Placement" p WHERE p."teamId" = t.id) AS "hasPlacements"
    FROM "Team" t JOIN "Room" r ON r.id = t."roomId"
    WHERE r."activityId" = ${activityId} AND r."archivedAt" IS NULL AND t."archivedAt" IS NULL`;
  const roomIds = new Set(liveRooms.map((r) => r.id));
  const teamIds = new Set(liveTeams.map((t) => t.id));

  const wantedRoomIds = new Set<number>();
  const wantedTeams = new Map<number, number>(); // team id -> new size
  for (const r of input) {
    if (r.id !== undefined) {
      if (!roomIds.has(r.id))
        throw new AppError('TEAM_NOT_IN_ACTIVITY', 422, `Room ${r.id} is not part of this activity`);
      if (wantedRoomIds.has(r.id)) throw new AppError('VALIDATION_ERROR', 422, 'Duplicate room id');
      wantedRoomIds.add(r.id);
    }
    for (const t of r.teams) {
      if (t.id === undefined) continue;
      if (!teamIds.has(t.id))
        throw new AppError('TEAM_NOT_IN_ACTIVITY', 422, `Team ${t.id} is not part of this activity`);
      if (wantedTeams.has(t.id)) throw new AppError('VALIDATION_ERROR', 422, 'Duplicate team id');
      wantedTeams.set(t.id, t.size);
    }
  }
  const keys = input.map((r) => r.key);
  if (new Set(keys).size !== keys.length) throw new AppError('VALIDATION_ERROR', 422, 'Duplicate room key');

  // FR-5.9: only occurrences that have not started are checked.
  const held = await tx.$queryRaw<{ teamId: number; maxSlot: number }[]>`
    SELECT p."teamId", max(p.slot)::int AS "maxSlot"
    FROM "Placement" p
    JOIN "Occurrence" o ON o.id = p."occurrenceId"
    JOIN "ScheduleEvent" e ON e.id = o."eventId"
    WHERE e."activityId" = ${activityId} AND o."startsAt" > clock_timestamp()
    GROUP BY p."teamId"`;
  const violations: Violation[] = [];
  for (const h of held) {
    if (!teamIds.has(h.teamId)) continue;
    const newSize = wantedTeams.get(h.teamId) ?? 0;
    if (h.maxSlot > newSize) violations.push({ teamId: h.teamId, placed: h.maxSlot, size: newSize });
  }
  if (violations.length > 0) {
    throw new AppError(
      'LAYOUT_BELOW_PLACED',
      409,
      'The layout change would leave placed members without a slot',
      {
        ...violations[0]!,
        violations,
      },
    );
  }

  const stats = {
    roomsCreated: 0,
    roomsArchived: 0,
    roomsDeleted: 0,
    teamsCreated: 0,
    teamsArchived: 0,
    teamsDeleted: 0,
  };

  // 1. removed teams: archive when they ever held a placement, else delete
  for (const t of liveTeams.filter((x) => !wantedTeams.has(x.id))) {
    if (t.hasPlacements) {
      await tx.team.update({ where: { id: t.id }, data: { archivedAt: new Date() } });
      stats.teamsArchived++;
    } else {
      await tx.team.delete({ where: { id: t.id } });
      stats.teamsDeleted++;
    }
  }
  // 2. removed rooms: delete when nothing is left in them, otherwise archive
  for (const r of liveRooms.filter((x) => !wantedRoomIds.has(x.id))) {
    const left = await tx.team.count({ where: { roomId: r.id } });
    if (left === 0) {
      await tx.room.delete({ where: { id: r.id } });
      stats.roomsDeleted++;
    } else {
      await tx.room.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
      stats.roomsArchived++;
    }
  }
  // 3. two-phase key change so swapping keys cannot trip the live-key unique index
  for (const r of input)
    if (r.id !== undefined) await tx.room.update({ where: { id: r.id }, data: { key: `~tmp~${r.id}` } });
  // 4. rooms and teams
  for (const [ri, r] of input.entries()) {
    const room =
      r.id !== undefined
        ? await tx.room.update({ where: { id: r.id }, data: { key: r.key, name: r.name, sortOrder: ri } })
        : await tx.room.create({ data: { activityId, key: r.key, name: r.name, sortOrder: ri } });
    if (r.id === undefined) stats.roomsCreated++;
    for (const [ti, t] of r.teams.entries()) {
      if (t.id !== undefined) {
        await tx.team.update({
          where: { id: t.id },
          data: { roomId: room.id, name: t.name, size: t.size, sortOrder: ti },
        });
      } else {
        await tx.team.create({ data: { roomId: room.id, name: t.name, size: t.size, sortOrder: ti } });
        stats.teamsCreated++;
      }
    }
  }
  await tx.$executeRaw`
    UPDATE "Occurrence" o SET "planVersion" = o."planVersion" + 1
    FROM "ScheduleEvent" e
    WHERE e.id = o."eventId" AND e."activityId" = ${activityId} AND o."startsAt" > clock_timestamp()`;
  await record(tx, {
    actorType: 'MEMBER',
    actorId: actor.memberId,
    action: 'layout.update',
    entityType: 'activity',
    entityId: activityId,
    meta: stats,
    requestId,
  });
  return readLayout(tx, activityId);
}
