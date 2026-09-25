import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { memberClaimLock } from '../../lib/locks.js';
import type { Tx } from '../../lib/tx.js';
import { myWinCount, openWindow, readItem, type ItemView } from './rounds.js';

/**
 * Type 1 live claim and release (design 7.1). Hot path: raw SQL inside one interactive transaction (tx() with
 * maxWait/timeout from env). Lock order: round row FOR SHARE, then the member advisory lock, then rows.
 *
 * FOR SHARE lets many members proceed together, while admin close / finalize take FOR UPDATE and wait for in-flight
 * claims; later claims then see CLOSED, so no claim can commit after a close returned. All time comparisons are
 * DB-side (clock_timestamp()) after any lock wait.
 */
export type ClaimResult = { item: ItemView; myWinCount: number };

export async function claimItem(
  tx: Tx,
  a: { roundId: number; itemId: number; memberId: string; requestId?: string },
): Promise<ClaimResult> {
  const { roundId, itemId, memberId } = a;
  const gate = await openWindow(tx, roundId, 'LIVE_CLAIM');
  await memberClaimLock(tx, roundId, memberId);

  const [cur] = await tx.$queryRaw<{ winnerId: string | null; disabled: boolean }[]>`
    SELECT "winnerId", disabled FROM "AuctionItem" WHERE id = ${itemId} AND "roundId" = ${roundId}`;
  if (!cur) throw new AppError('NOT_FOUND', 404, 'Item not found in this round');
  if (cur.disabled) throw new AppError('ITEM_DISABLED', 409, 'The admin disabled this item');
  // Idempotent retry BEFORE the cap check: a retry at 5/5 must not report CLAIM_CAP_REACHED for an item the caller owns.
  if (cur.winnerId === memberId) return respond(tx, roundId, itemId, memberId);

  const cap = gate.winCap ?? 5;
  if ((await myWinCount(tx, roundId, memberId)) >= cap) {
    throw new AppError('CLAIM_CAP_REACHED', 409, `You can claim at most ${cap} items in this round`, {
      winCap: cap,
    });
  }

  // One conditional write decides the winner; a concurrent second UPDATE waits on the row lock, re-evaluates
  // "winnerId IS NULL" after the first commits and matches zero rows (Read Committed is enough).
  const won = await tx.$queryRaw<{ wonAt: Date }[]>`
    UPDATE "AuctionItem" SET "winnerId" = ${memberId}::uuid, "wonAt" = clock_timestamp(), "winSource" = 'CLAIM'
    WHERE id = ${itemId} AND "roundId" = ${roundId} AND "winnerId" IS NULL
    RETURNING "wonAt"`;
  if (won.length === 0) {
    const item = await readItem(tx, roundId, itemId);
    if (item?.winner?.memberId === memberId) return respond(tx, roundId, itemId, memberId); // won by our own parallel tab
    throw new AppError('ITEM_ALREADY_CLAIMED', 409, 'Someone else claimed this item first', {
      winner: item?.winner ?? null,
    });
  }
  await record(tx, {
    actorType: 'MEMBER',
    actorId: memberId,
    action: 'auction.claim',
    entityType: 'auction_item',
    entityId: String(itemId),
    meta: { roundId, wonAt: won[0]!.wonAt },
    requestId: a.requestId,
  });
  return respond(tx, roundId, itemId, memberId);
}

/** Release own claim while the window is open. The cap uses a live count, so nothing can drift. */
export async function releaseItem(
  tx: Tx,
  a: { roundId: number; itemId: number; memberId: string; requestId?: string },
): Promise<ClaimResult> {
  const { roundId, itemId, memberId } = a;
  await openWindow(tx, roundId, 'LIVE_CLAIM');
  const rows = await tx.$queryRaw<{ id: number }[]>`
    UPDATE "AuctionItem" SET "winnerId" = NULL, "wonAt" = NULL, "winSource" = NULL
    WHERE id = ${itemId} AND "roundId" = ${roundId} AND "winnerId" = ${memberId}::uuid
    RETURNING id`;
  if (rows.length === 0) {
    const item = await readItem(tx, roundId, itemId);
    if (!item) throw new AppError('NOT_FOUND', 404, 'Item not found in this round');
    if (item.winner) throw new AppError('NOT_YOUR_CLAIM', 403, 'That item is claimed by someone else');
    return respond(tx, roundId, itemId, memberId); // already free: idempotent
  }
  await record(tx, {
    actorType: 'MEMBER',
    actorId: memberId,
    action: 'auction.release',
    entityType: 'auction_item',
    entityId: String(itemId),
    meta: { roundId },
    requestId: a.requestId,
  });
  return respond(tx, roundId, itemId, memberId);
}

async function respond(tx: Tx, roundId: number, itemId: number, memberId: string): Promise<ClaimResult> {
  return {
    item: (await readItem(tx, roundId, itemId))!,
    myWinCount: await myWinCount(tx, roundId, memberId),
  };
}
