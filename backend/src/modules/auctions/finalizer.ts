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
 * during the window are out), persist the snapshot as the frozen input, allocate (pure), write winners, re-queue
 * ALL winners at the tail per category in their previous queue order, copy leftovers into ONE DRAFT type-1 round
 * (sourceRoundId), stamp allocatedAt/algorithmVersion, audit.
 */
export async function allocateRound(tx: Tx, round: RoundRow, requestId?: string): Promise<boolean> {
  const [state] = await tx.$queryRaw<{ allocatedAt: Date | null; createdById: string }[]>`
    SELECT "allocatedAt", "createdById" FROM "AuctionRound" WHERE id = ${round.id}`;
  if (state!.allocatedAt) return false;

  const items = await tx.$queryRaw<
    {
      id: number;
      name: string;
      category: string;
      rarity: string | null;
      imageUrl: string | null;
      sortOrder: number;
    }[]
  >`SELECT id, name, category, rarity, "imageUrl", "sortOrder" FROM "AuctionItem" WHERE "roundId" = ${round.id} ORDER BY "sortOrder", id`;
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

  // Re-queue: every winner gets a fresh tail entry per category, ordered by their previous queue position.
  // Non-winners keep their ids (relative order, in front); latecomers (ids above the cutoff) stay ahead of winners.
  const requeued: Record<string, string[]> = {};
  for (const category of [...categories].sort()) {
    const winners = awards.filter((a) => a.category === category).sort((x, y) => x.position - y.position);
    for (const a of winners) {
      await tx.$executeRaw`DELETE FROM "QueueEntry" WHERE category = ${category}::"ItemCategory" AND "memberId" = ${a.memberId}::uuid`;
      await tx.$executeRaw`INSERT INTO "QueueEntry" (category, "memberId") VALUES (${category}::"ItemCategory", ${a.memberId}::uuid)`;
    }
    requeued[category] = winners.map((w) => w.memberId);
  }

  // Leftovers: every item that ended unallocated becomes an item of ONE draft type-1 round (never auto-opened).
  const won = new Set(awards.map((a) => a.itemId));
  const leftovers = items.filter((i) => !won.has(i.id));
  let leftoverRoundId: number | null = null;
  if (leftovers.length > 0) {
    const [created] = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "AuctionRound" (type, name, status, "durationSec", "winCap", "startDelaySec", "sourceRoundId", "createdById")
      VALUES ('LIVE_CLAIM', ${`${round.name} (leftovers)`}, 'DRAFT', 300, 5, 3, ${round.id}, ${state!.createdById}::uuid)
      RETURNING id`;
    leftoverRoundId = created!.id;
    for (const [i, it] of leftovers.entries()) {
      await tx.$executeRaw`
        INSERT INTO "AuctionItem" ("roundId", name, category, rarity, "imageUrl", "sortOrder")
        VALUES (${leftoverRoundId}, ${it.name}, ${it.category}::"ItemCategory", ${it.rarity}, ${it.imageUrl}, ${i})`;
    }
  }

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
    leftoverItems: leftovers.map((l) => l.id),
    leftoverRoundId,
  });
  await audit('auction.requeue', { requeued });
  return true;
}
