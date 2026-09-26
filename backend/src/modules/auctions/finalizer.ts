import { record } from '../../lib/audit.js';
import { categoryLocks } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';
import {
  ALGORITHM_VERSION,
  allocate,
  type Award,
  type Preferences,
  type QueueSnapshot,
} from './allocation.js';
import type { RoundRow } from './rounds.js';

/** Members' saved lists, ordered by rank, as the pure allocation function wants them. */
export async function loadPreferences(db: Pick<Tx, '$queryRaw'>, roundId: number): Promise<Preferences> {
  const rows = await db.$queryRaw<{ memberId: string; itemId: number }[]>`
    SELECT "memberId", "itemId" FROM "Preference" WHERE "roundId" = ${roundId} ORDER BY "memberId", rank`;
  const prefs = new Map<string, number[]>();
  for (const r of rows) (prefs.get(r.memberId) ?? prefs.set(r.memberId, []).get(r.memberId)!).push(r.itemId);
  return prefs;
}

/**
 * Allocation and close-out of a type-2 round (design 7.2 "Finalize"). One transaction. The caller holds the
 * round row FOR UPDATE (so every in-flight preference submit finished, later ones see CLOSED) and has already set
 * the round to CLOSED. Lock order: round, then category advisory locks (sorted), then rows.
 *
 * Idempotent: a round with allocatedAt set is left alone (returns false).
 * Steps: snapshot the queue of each category (entries with id <= cutoff that still exist, so members who left
 * during the window are out), persist the snapshot as the frozen input, allocate (pure), write winners, take every
 * winner OUT of the queue of the category they won (they join again if they want another), stamp
 * allocatedAt/algorithmVersion, audit.
 * Items nobody was allocated simply stay without a winner: a queue round makes no leftover round.
 */
export async function allocateRound(tx: Tx, round: RoundRow, requestId?: string): Promise<boolean> {
  const [state] = await tx.$queryRaw<{ allocatedAt: Date | null }[]>`
    SELECT "allocatedAt" FROM "AuctionRound" WHERE id = ${round.id}`;
  if (state!.allocatedAt) return false;

  const items = await tx.$queryRaw<{ id: number; category: string }[]>`SELECT id, category FROM "AuctionItem"
    WHERE "roundId" = ${round.id} AND NOT disabled ORDER BY "sortOrder", id`; // a disabled item is never allocated
  const categories = [...new Set(items.map((i) => i.category))];
  await categoryLocks(tx, categories);

  const cutoffs = await tx.$queryRaw<{ category: string; cutoffId: number }[]>`
    SELECT category, "cutoffId" FROM "RoundQueueCutoff" WHERE "roundId" = ${round.id}`;
  const cutoff = new Map(cutoffs.map((c) => [c.category, c.cutoffId]));

  const queues: QueueSnapshot = {};
  for (const category of [...categories].sort()) {
    const rows = await tx.$queryRaw<{ memberId: string; id: number }[]>`
      SELECT q."memberId", q.id FROM "QueueEntry" q JOIN "Member" m ON m.id = q."memberId" AND m."isActive"
      WHERE q.category = ${category}::"ItemCategory" AND q.id <= ${cutoff.get(category) ?? 0}::int ORDER BY q.id`;
    queues[category] = rows.map((r) => r.memberId);
    for (const [i, r] of rows.entries()) {
      await tx.$executeRaw`
        INSERT INTO "RoundQueueSnapshot" ("roundId", category, "memberId", position)
        VALUES (${round.id}, ${category}::"ItemCategory", ${r.memberId}::uuid, ${i + 1})`;
    }
  }

  const awards = allocate(queues, items, await loadPreferences(tx, round.id));
  for (const a of awards) {
    await tx.$executeRaw`
      UPDATE "AuctionItem" SET "winnerId" = ${a.memberId}::uuid, "wonAt" = clock_timestamp(),
             "winSource" = 'ALLOCATION', "queuePos" = ${a.position}
      WHERE id = ${a.itemId} AND "roundId" = ${round.id} AND "winnerId" IS NULL`;
  }

  // Dequeue: every winner leaves the queue of the category they won. Everyone else keeps their entry (and order);
  // the winner's other queues are untouched.
  const dequeued: Record<string, string[]> = {};
  for (const category of [...categories].sort()) {
    const winners = awards.filter((a) => a.category === category).sort((x, y) => x.position - y.position);
    for (const a of winners) {
      await tx.$executeRaw`DELETE FROM "QueueEntry" WHERE category = ${category}::"ItemCategory" AND "memberId" = ${a.memberId}::uuid`;
    }
    dequeued[category] = winners.map((w) => w.memberId);
  }

  // Items that ended unallocated stay in this round without a winner (no leftover round is made).
  const won = new Set(awards.map((a) => a.itemId));
  const unallocated = items.filter((i) => !won.has(i.id));

  await tx.$executeRaw`
    UPDATE "AuctionRound" SET "allocatedAt" = clock_timestamp(), "algorithmVersion" = ${ALGORITHM_VERSION}::int
    WHERE id = ${round.id}`;

  const audit = (action: string, meta: Record<string, unknown>) =>
    record(tx, {
      actorType: 'SYSTEM',
      action,
      entityType: 'auction_round',
      entityId: String(round.id),
      meta: meta as never,
      requestId,
    });
  await audit('auction.allocation', {
    algorithmVersion: ALGORITHM_VERSION,
    awards: awards.map((a: Award) => ({
      itemId: a.itemId,
      memberId: a.memberId,
      category: a.category,
      position: a.position,
    })),
    unallocatedItems: unallocated.map((l) => l.id),
  });
  await audit('auction.dequeue', { dequeued });
  return true;
}
