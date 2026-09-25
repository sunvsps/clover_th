import type { PrismaClient } from '@prisma/client';
import { allocate, type QueueSnapshot } from './allocation.js';
import { loadPreferences } from './finalizer.js';

export type ReplayResult = {
  roundId: number;
  algorithmVersion: number | null;
  /** true when allocate(stored snapshot, stored items, stored preferences) equals the stored winners */
  matches: boolean;
  expected: { itemId: number; memberId: string; position: number }[];
  stored: { itemId: number; memberId: string; position: number }[];
};

/**
 * Replays an allocation from the STORED inputs only (RoundQueueSnapshot, items, Preference) and compares it with the
 * stored results (FR-3.12). Read-only. Used by scripts/replay-allocation.ts and by tests.
 */
export async function replayAllocation(prisma: PrismaClient, roundId: number): Promise<ReplayResult> {
  const round = await prisma.auctionRound.findUniqueOrThrow({ where: { id: roundId } });
  const items = await prisma.auctionItem.findMany({ where: { roundId }, orderBy: { id: 'asc' } });
  const snapshot = await prisma.roundQueueSnapshot.findMany({
    where: { roundId },
    orderBy: [{ category: 'asc' }, { position: 'asc' }],
  });
  const queues: QueueSnapshot = {};
  for (const s of snapshot) (queues[s.category] ??= []).push(s.memberId);
  // A queue round's items always have a category (assertCategoriesForType); untagged ones can't be allocated anyway.
  const allocItems = items.flatMap((i) => (i.category && !i.disabled ? [{ id: i.id, category: i.category }] : []));
  const expected = allocate(queues, allocItems, await loadPreferences(prisma, roundId))
    .map((a) => ({ itemId: a.itemId, memberId: a.memberId, position: a.position }))
    .sort((a, b) => a.itemId - b.itemId);
  const stored = items
    .filter((i) => i.winnerId)
    .map((i) => ({ itemId: i.id, memberId: i.winnerId!, position: i.queuePos! }))
    .sort((a, b) => a.itemId - b.itemId);
  return {
    roundId,
    algorithmVersion: round.algorithmVersion,
    matches: JSON.stringify(expected) === JSON.stringify(stored),
    expected,
    stored,
  };
}
