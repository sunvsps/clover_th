/**
 * The ONLY place database locks are taken (design 3.2, 7.3).
 *
 * GLOBAL LOCK ORDER (always acquire in this order, never the reverse):
 *   1. Activity row(s)            (withActivityLock / lockActivities; several activities in ascending id order)
 *   2. AuctionRound row           (withRoundLock)
 *   3. category / member advisory locks, sorted  (memberClaimLock, categoryLocks)
 *   4. ordinary rows
 *
 * The Activity row always exists, so lazily created Occurrence rows cannot escape it. Occurrence is a
 * data row only, never a lock.
 */
import { AppError } from './errors.js';
import type { Tx } from './tx.js';

/** Serializes every registration, placement, layout, capacity and backfill write for one activity. */
export async function withActivityLock(tx: Tx, activityId: string): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Activity" WHERE id = ${activityId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 404, 'Activity not found');
}

/** Locks several activities in ascending id order (deactivation locks all of them: at most 14 rows). */
export async function lockActivities(tx: Tx, ids?: string[]): Promise<string[]> {
  const rows = ids
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Activity" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Activity" ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id);
}

/** Member writes (claim, release, submit) take SHARE; finalize and admin close take UPDATE. */
export async function withRoundLock(tx: Tx, roundId: number, mode: 'SHARE' | 'UPDATE'): Promise<void> {
  const rows =
    mode === 'SHARE'
      ? await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "AuctionRound" WHERE id = ${roundId} FOR SHARE`
      : await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "AuctionRound" WHERE id = ${roundId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError('NOT_FOUND', 404, 'Round not found');
}

/**
 * Serializes one member's claims in one round so two tabs cannot exceed the cap (taken AFTER the round lock,
 * per the global order). Released automatically at commit/rollback.
 */
export async function memberClaimLock(
  tx: Tx,
  roundId: number,
  memberId: string,
  kind: 'claim' | 'pref' = 'claim',
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}:${roundId}:${memberId}`}, 0))`;
}

/**
 * Queue join/leave, round start (cutoffs), finalize and dequeue serialize per category, so QueueEntry id order
 * equals commit order. Several categories are always taken in sorted order (deadlock-free).
 */
export async function categoryLocks(tx: Tx, categories: readonly string[]): Promise<void> {
  for (const c of [...new Set(categories)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`queue:${c}`}, 0))`;
  }
}
