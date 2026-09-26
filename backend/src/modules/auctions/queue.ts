import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { categoryLocks } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';
import { QUEUE_CATEGORIES, type QueueCategory } from './allocation.js';

type Db = Pick<Tx, '$queryRaw'>;

export function parseCategory(raw: string): QueueCategory {
  if (!(QUEUE_CATEGORIES as readonly string[]).includes(raw)) {
    throw new AppError('INVALID_QUEUE_CATEGORY', 422, 'The queue category must be GEAR, CARD or RELIC');
  }
  return raw as QueueCategory;
}

export type QueueView = {
  category: QueueCategory;
  length: number;
  myRank: number | null;
  entries: { rank: number; memberId: string }[];
};

/**
 * Persistent per-category queue (FR-3.1/3.2): QueueEntry.id is the order key and join/leave hold the category
 * advisory lock until commit, so id order equals commit order. Rank = position in id order.
 */
export async function readQueues(db: Db, memberId: string): Promise<QueueView[]> {
  const rows = await db.$queryRaw<{ category: QueueCategory; memberId: string }[]>`
    SELECT category, "memberId" FROM "QueueEntry" ORDER BY category, id`;
  return QUEUE_CATEGORIES.map((category) => {
    const entries = rows
      .filter((r) => r.category === category)
      .map((r, i) => ({ rank: i + 1, memberId: r.memberId }));
    return {
      category,
      length: entries.length,
      myRank: entries.find((e) => e.memberId === memberId)?.rank ?? null,
      entries,
    };
  });
}

/** Join (idempotent): an existing entry keeps its place. A rejoin after leaving is a new entry at the tail. */
export async function joinQueue(tx: Tx, category: QueueCategory, memberId: string, requestId?: string) {
  await categoryLocks(tx, [category]);
  // A deactivation that committed after the session lookup must not leave a ghost entry behind (review M-3).
  const [m] = await tx.$queryRaw<
    { isActive: boolean }[]
  >`SELECT "isActive" FROM "Member" WHERE id = ${memberId}::uuid`;
  if (!m?.isActive) throw new AppError('MEMBER_INACTIVE', 422, 'Member is deactivated');
  const inserted = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO "QueueEntry" (category, "memberId") VALUES (${category}::"ItemCategory", ${memberId}::uuid)
    ON CONFLICT (category, "memberId") DO NOTHING RETURNING id`;
  if (inserted.length > 0) {
    await record(tx, {
      actorType: 'MEMBER',
      actorId: memberId,
      action: 'queue.join',
      entityType: 'queue',
      entityId: category,
      meta: { entryId: inserted[0]!.id },
      requestId,
    });
  }
  return queueSummary(tx, category, memberId);
}

/**
 * Leave (idempotent). During an open window this also removes eligibility for that round: eligibility needs an entry
 * with id <= cutoff, and rejoining creates a bigger id (FR-3.11).
 */
export async function leaveQueue(tx: Tx, category: QueueCategory, memberId: string, requestId?: string) {
  await categoryLocks(tx, [category]);
  const gone = await tx.$queryRaw<{ id: number }[]>`
    DELETE FROM "QueueEntry" WHERE category = ${category}::"ItemCategory" AND "memberId" = ${memberId}::uuid RETURNING id`;
  if (gone.length > 0) {
    await record(tx, {
      actorType: 'MEMBER',
      actorId: memberId,
      action: 'queue.leave',
      entityType: 'queue',
      entityId: category,
      meta: { entryId: gone[0]!.id },
      requestId,
    });
  }
  return queueSummary(tx, category, memberId);
}

/** Admin removes a member from one queue (idempotent). Same effect as that member leaving, audited to the admin. */
export async function removeFromQueue(
  tx: Tx,
  category: QueueCategory,
  memberId: string,
  adminId: string,
  requestId?: string,
) {
  await categoryLocks(tx, [category]);
  const gone = await tx.$queryRaw<{ id: number }[]>`
    DELETE FROM "QueueEntry" WHERE category = ${category}::"ItemCategory" AND "memberId" = ${memberId}::uuid RETURNING id`;
  if (gone.length > 0) {
    await record(tx, {
      actorType: 'MEMBER',
      actorId: adminId,
      action: 'queue.remove',
      entityType: 'queue',
      entityId: category,
      meta: { memberId, entryId: gone[0]!.id },
      requestId,
    });
  }
  return queueSummary(tx, category, memberId);
}

/**
 * Admin rewrites one queue in the given order (FR admin queue edit): adds, removes and reorders in one save.
 * `expected` is the order the admin loaded; if the queue changed since (a member joined or left), nothing is written
 * (QUEUE_CHANGED) so their change is not overwritten. The order key is QueueEntry.id, so every entry is rewritten
 * with a new id in the new order (joinedAt is kept). That would drop everyone's eligibility for an OPEN queue round of
 * this category (eligibility = id <= the round's cutoff), so it is refused while one is open (QUEUE_ROUND_OPEN).
 */
export async function replaceQueue(
  tx: Tx,
  category: QueueCategory,
  memberIds: string[],
  expected: string[] | undefined,
  adminId: string,
  requestId?: string,
): Promise<{ category: QueueCategory; length: number; entries: { rank: number; memberId: string }[] }> {
  await categoryLocks(tx, [category]);
  const [open] = await tx.$queryRaw<{ id: number }[]>`
    SELECT r.id FROM "AuctionRound" r JOIN "RoundQueueCutoff" c ON c."roundId" = r.id
    WHERE r.status = 'OPEN' AND r.type = 'QUEUE_RANKED' AND c.category = ${category}::"ItemCategory" LIMIT 1`;
  if (open) {
    throw new AppError('QUEUE_ROUND_OPEN', 409, 'The queue cannot be edited while a queue round of this category is open', {
      roundId: open.id,
    });
  }
  const current = await tx.$queryRaw<{ memberId: string; joinedAt: Date }[]>`
    SELECT "memberId", "joinedAt" FROM "QueueEntry" WHERE category = ${category}::"ItemCategory" ORDER BY id`;
  const before = current.map((c) => c.memberId);
  if (expected && (expected.length !== before.length || expected.some((id, i) => id !== before[i]))) {
    throw new AppError('QUEUE_CHANGED', 409, 'The queue changed since it was loaded; reload and try again');
  }
  if (new Set(memberIds).size !== memberIds.length) {
    throw new AppError('VALIDATION_ERROR', 422, 'A member can be in a queue once');
  }
  if (memberIds.length > 0) {
    const active = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM "Member" WHERE id = ANY(${memberIds}::uuid[]) AND "isActive"`;
    const ok = new Set(active.map((m) => m.id));
    const bad = memberIds.filter((id) => !ok.has(id));
    if (bad.length > 0) throw new AppError('MEMBER_INACTIVE', 422, 'Unknown or deactivated member', { memberIds: bad });
  }
  const unchanged = memberIds.length === before.length && memberIds.every((id, i) => id === before[i]);
  if (!unchanged) {
    const joined = new Map(current.map((c) => [c.memberId, c.joinedAt]));
    await tx.$executeRaw`DELETE FROM "QueueEntry" WHERE category = ${category}::"ItemCategory"`;
    for (const id of memberIds) {
      const at = joined.get(id);
      if (at) {
        await tx.$executeRaw`INSERT INTO "QueueEntry" (category, "memberId", "joinedAt")
          VALUES (${category}::"ItemCategory", ${id}::uuid, ${at})`;
      } else {
        await tx.$executeRaw`INSERT INTO "QueueEntry" (category, "memberId") VALUES (${category}::"ItemCategory", ${id}::uuid)`;
      }
    }
    await record(tx, {
      actorType: 'MEMBER',
      actorId: adminId,
      action: 'queue.edit',
      entityType: 'queue',
      entityId: category,
      meta: { before, after: memberIds },
      requestId,
    });
  }
  return { category, length: memberIds.length, entries: memberIds.map((memberId, i) => ({ rank: i + 1, memberId })) };
}

export type QueueWin = {
  roundId: number;
  roundName: string;
  itemId: number;
  itemName: string;
  category: QueueCategory;
  memberId: string;
  queuePos: number | null;
  wonAt: string;
};

/** Items won through queue allocation across all rounds: newest round first, items in round order. */
export async function readQueueHistory(db: Db, limit: number): Promise<QueueWin[]> {
  const rows = await db.$queryRaw<(Omit<QueueWin, 'wonAt'> & { wonAt: Date })[]>`
    SELECT r.id AS "roundId", r.name AS "roundName", i.id AS "itemId", i.name AS "itemName", i.category::text AS category,
           i."winnerId"::text AS "memberId", i."queuePos", i."wonAt"
    FROM "AuctionItem" i JOIN "AuctionRound" r ON r.id = i."roundId"
    WHERE i."winSource" = 'ALLOCATION' AND i."winnerId" IS NOT NULL
    ORDER BY r."closedAt" DESC NULLS LAST, r.id DESC, i."sortOrder", i.id
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, wonAt: r.wonAt.toISOString() }));
}

async function queueSummary(tx: Tx, category: QueueCategory, memberId: string) {
  const q = (await readQueues(tx, memberId)).find((x) => x.category === category)!;
  return { category, length: q.length, myRank: q.myRank };
}
