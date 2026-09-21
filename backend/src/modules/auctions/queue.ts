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

async function queueSummary(tx: Tx, category: QueueCategory, memberId: string) {
  const q = (await readQueues(tx, memberId)).find((x) => x.category === category)!;
  return { category, length: q.length, myRank: q.myRank };
}
