import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { memberClaimLock } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';
import { openWindow } from './rounds.js';

type Db = Pick<Tx, '$queryRaw'>;

/** Categories in which the member is eligible for a round: an entry with id <= the round's cutoff (FR-3.6). */
export async function eligibleCategories(db: Db, roundId: number, memberId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ category: string }[]>`
    SELECT c.category::text AS category
    FROM "RoundQueueCutoff" c
    JOIN "QueueEntry" q ON q.category = c.category AND q."memberId" = ${memberId}::uuid AND q.id <= c."cutoffId"
    WHERE c."roundId" = ${roundId} ORDER BY c.category`;
  return rows.map((r) => r.category);
}

/**
 * Submit a ranked list (design 7.2, B2). Lock order: round FOR SHARE (through openWindow), then the member's
 * preference lock, then rows. Finalize/close take the round FOR UPDATE, so a submit that returned 200 is always part
 * of the stored allocation inputs, and one that arrives later sees CLOSED (ROUND_CLOSED): nothing is silently ignored.
 * The list replaces the previous one; `[]` clears it. Ranks are dense 1..n over the whole list.
 */
export async function submitPreferences(
  tx: Tx,
  a: { roundId: number; memberId: string; itemIds: number[]; requestId?: string },
): Promise<{ itemIds: number[] }> {
  const { roundId, memberId, itemIds } = a;
  await openWindow(tx, roundId, 'QUEUE_RANKED');
  await memberClaimLock(tx, roundId, memberId, 'pref');

  if (new Set(itemIds).size !== itemIds.length) {
    throw new AppError('INVALID_PREFERENCE_LIST', 422, 'The list contains duplicate items');
  }
  if (itemIds.length > 0) {
    const found = await tx.$queryRaw<{ id: number; category: string }[]>`
      SELECT id, category::text AS category FROM "AuctionItem" WHERE "roundId" = ${roundId} AND id = ANY(${itemIds}::int[])`;
    if (found.length !== itemIds.length) {
      throw new AppError(
        'INVALID_PREFERENCE_LIST',
        422,
        'The list contains unknown items or items of another round',
      );
    }
    const eligible = new Set(await eligibleCategories(tx, roundId, memberId));
    for (const cat of new Set(found.map((f) => f.category))) {
      if (!eligible.has(cat)) {
        throw new AppError(
          'NOT_ELIGIBLE_FOR_CATEGORY',
          409,
          `You are not in the ${cat} queue for this round`,
          { category: cat },
        );
      }
    }
  }

  await tx.$executeRaw`DELETE FROM "Preference" WHERE "roundId" = ${roundId} AND "memberId" = ${memberId}::uuid`;
  for (const [i, itemId] of itemIds.entries()) {
    await tx.$executeRaw`
      INSERT INTO "Preference" ("roundId", "memberId", "itemId", rank) VALUES (${roundId}, ${memberId}::uuid, ${itemId}, ${i + 1})`;
  }
  await record(tx, {
    actorType: 'MEMBER',
    actorId: memberId,
    action: 'auction.preferences.submit',
    entityType: 'auction_round',
    entityId: String(roundId),
    meta: { count: itemIds.length, itemIds },
    requestId: a.requestId,
  });
  return { itemIds };
}

/** Own list, in rank order. */
export async function readMyPreferences(db: Db, roundId: number, memberId: string): Promise<number[]> {
  const rows = await db.$queryRaw<{ itemId: number }[]>`
    SELECT "itemId" FROM "Preference" WHERE "roundId" = ${roundId} AND "memberId" = ${memberId}::uuid ORDER BY rank`;
  return rows.map((r) => r.itemId);
}

/** Admin view: every member's list. */
export async function readAllPreferences(
  db: Db,
  roundId: number,
): Promise<{ memberId: string; itemIds: number[] }[]> {
  const rows = await db.$queryRaw<{ memberId: string; itemId: number }[]>`
    SELECT "memberId", "itemId" FROM "Preference" WHERE "roundId" = ${roundId} ORDER BY "memberId", rank`;
  const out = new Map<string, number[]>();
  for (const r of rows) (out.get(r.memberId) ?? out.set(r.memberId, []).get(r.memberId)!).push(r.itemId);
  return [...out].map(([memberId, itemIds]) => ({ memberId, itemIds }));
}
