import { createHash } from 'node:crypto';
import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { categoryLocks, withRoundLock } from '../../lib/locks.js';
import { isUniqueViolation } from '../../lib/pgErrors.js';
import type { Tx } from '../../lib/tx.js';
import { allocateRound } from './finalizer.js';
import { QUEUE_CATEGORIES } from './allocation.js';

type Db = Pick<Tx, '$queryRaw'>;

export type ItemCategory = 'PET' | 'MATERIAL' | 'GEMBOX' | 'GEAR' | 'CARD' | 'RELIC';
export type RoundStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export type RoundRow = {
  id: number;
  type: 'LIVE_CLAIM' | 'QUEUE_RANKED';
  name: string;
  status: RoundStatus;
  durationSec: number;
  winCap: number | null;
  startDelaySec: number;
  opensAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
};

export type ItemInput = {
  name: string;
  /** Unset (or null) when an admin creates a live-claim round without tagging the item; it stays uncategorized.
   * A queue-ranked round needs Gear, Card or Relic on every item (see assertCategoriesForType). */
  category?: ItemCategory | null;
  rarity?: string | null;
  imageUrl?: string | null;
  /** keeps its slot on the board but can't be claimed or ranked (default false) */
  disabled?: boolean;
};

export type ItemView = {
  id: number;
  name: string;
  /** null = the admin left the item untagged (live-claim rounds only) */
  category: ItemCategory | null;
  rarity: string | null;
  imageUrl: string | null;
  /** the admin disabled the item: it shows on the board but can't be claimed or ranked */
  disabled: boolean;
  /** queuePos: the winner's position in the frozen queue snapshot (type 2), null for a live claim */
  winner: { memberId: string; wonAt: string; queuePos: number | null } | null;
};

export async function readRound(db: Db, id: number): Promise<RoundRow | null> {
  const rows = await db.$queryRaw<RoundRow[]>`
    SELECT id, type, name, status, "durationSec", "winCap", "startDelaySec", "opensAt", "closesAt", "closedAt", "createdAt"
    FROM "AuctionRound" WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function readRoundOrThrow(db: Db, id: number): Promise<RoundRow> {
  const r = await readRound(db, id);
  if (!r) throw new AppError('NOT_FOUND', 404, 'Round not found');
  return r;
}

export async function dbNow(db: Db): Promise<Date> {
  const [r] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return r!.now;
}

type ItemRow = {
  id: number;
  name: string;
  category: ItemCategory | null;
  rarity: string | null;
  imageUrl: string | null;
  disabled: boolean;
  winnerId: string | null;
  wonAt: Date | null;
  queuePos: number | null;
};

const toItem = (i: ItemRow): ItemView => ({
  id: i.id,
  name: i.name,
  category: i.category,
  rarity: i.rarity,
  imageUrl: i.imageUrl,
  disabled: i.disabled,
  winner:
    i.winnerId && i.wonAt
      ? { memberId: i.winnerId, wonAt: i.wonAt.toISOString(), queuePos: i.queuePos }
      : null,
});

export async function readItems(db: Db, roundId: number, onlyWinner?: string): Promise<ItemView[]> {
  const rows = onlyWinner
    ? await db.$queryRaw<ItemRow[]>`
        SELECT id, name, category, rarity, "imageUrl", disabled, "winnerId", "wonAt", "queuePos" FROM "AuctionItem"
        WHERE "roundId" = ${roundId} AND "winnerId" = ${onlyWinner}::uuid ORDER BY "sortOrder", id`
    : await db.$queryRaw<ItemRow[]>`
        SELECT id, name, category, rarity, "imageUrl", disabled, "winnerId", "wonAt", "queuePos" FROM "AuctionItem"
        WHERE "roundId" = ${roundId} ORDER BY "sortOrder", id`;
  return rows.map(toItem);
}

export async function readItem(db: Db, roundId: number, itemId: number): Promise<ItemView | null> {
  const rows = await db.$queryRaw<ItemRow[]>`
    SELECT id, name, category, rarity, "imageUrl", disabled, "winnerId", "wonAt", "queuePos" FROM "AuctionItem"
    WHERE id = ${itemId} AND "roundId" = ${roundId}`;
  return rows[0] ? toItem(rows[0]) : null;
}

export async function myWinCount(db: Db, roundId: number, memberId: string): Promise<number> {
  const [r] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "AuctionItem" WHERE "roundId" = ${roundId} AND "winnerId" = ${memberId}::uuid`;
  return r!.n;
}

export const roundOut = (r: RoundRow) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  status: r.status,
  durationSec: r.durationSec,
  winCap: r.winCap,
  startDelaySec: r.startDelaySec,
  opensAt: r.opensAt ? r.opensAt.toISOString() : null,
  closesAt: r.closesAt ? r.closesAt.toISOString() : null,
});

/**
 * Cheap change fingerprint for polling (ETag): status, window, item count, winners count and the newest wonAt,
 * plus the caller's own win count (the body is per member). Computed by one aggregate, not by serializing the body.
 */
export async function roundFingerprint(db: Db, roundId: number, memberId: string): Promise<string | null> {
  const rows = await db.$queryRaw<
    {
      status: string;
      opensAt: Date | null;
      closesAt: Date | null;
      items: number;
      won: number;
      last: Date | null;
      mine: number;
      config: string;
      content: string;
    }[]
  >`
    SELECT r.status, r."opensAt", r."closesAt", count(i.id)::int AS items, count(i."winnerId")::int AS won,
           max(i."wonAt") AS last, (count(*) FILTER (WHERE i."winnerId" = ${memberId}::uuid))::int AS mine,
           -- everything an admin can edit on a draft: name, cap, timing, and every item's id/name/category/rarity/image
           concat_ws('|', r.name, r."winCap", r."durationSec", r."startDelaySec") AS config,
           md5(COALESCE(string_agg(concat_ws('|', i.id, i.name, i.category, i.rarity, i."imageUrl", i.disabled), ',' ORDER BY i.id), '')) AS content
    FROM "AuctionRound" r LEFT JOIN "AuctionItem" i ON i."roundId" = r.id
    WHERE r.id = ${roundId} GROUP BY r.id`;
  const x = rows[0];
  if (!x) return null;
  const raw = [
    roundId,
    memberId,
    x.status,
    x.opensAt?.getTime(),
    x.closesAt?.getTime(),
    x.items,
    x.won,
    x.last?.getTime(),
    x.mine,
    x.config,
    x.content,
  ].join('|');
  return `"${createHash('sha1').update(raw).digest('base64url')}"`;
}

// ---------- admin lifecycle ----------

/** A type-2 round covers Gear, Card and Relic only, so every item needs one of them (allocation and eligibility are
 * per category); a type-1 round accepts any category or none (leftovers roll into it). */
export function assertCategoriesForType(type: RoundRow['type'], items: ItemInput[]) {
  if (type !== 'QUEUE_RANKED') return;
  // a disabled item is never allocated, so it needs no category
  const bad = items.find((i) => !i.disabled && (!i.category || !(QUEUE_CATEGORIES as readonly string[]).includes(i.category)));
  if (bad) {
    throw new AppError(
      'INVALID_CATEGORY_FOR_TYPE',
      422,
      'A queue round accepts only Gear, Card and Relic items',
      {
        category: bad.category ?? null,
      },
    );
  }
}

export async function createRound(
  tx: Tx,
  a: {
    type: RoundRow['type'];
    name: string;
    durationSec: number;
    winCap: number | null;
    startDelaySec: number;
    items: ItemInput[];
    actorId: string;
    requestId?: string;
  },
): Promise<RoundRow> {
  const { items } = a;
  assertCategoriesForType(a.type, items);
  const created = await tx.auctionRound.create({
    data: {
      type: a.type,
      name: a.name,
      durationSec: a.durationSec,
      winCap: a.winCap,
      startDelaySec: a.startDelaySec,
      createdById: a.actorId,
      items: { create: items.map((it, i) => ({ ...itemData(it), sortOrder: i })) },
    },
  });
  await record(tx, {
    actorType: 'MEMBER',
    actorId: a.actorId,
    action: 'auction.round.create',
    entityType: 'auction_round',
    entityId: String(created.id),
    meta: { type: a.type, items: a.items.length, durationSec: a.durationSec, winCap: a.winCap },
    requestId: a.requestId,
  });
  return readRoundOrThrow(tx, created.id);
}

const itemData = (it: ItemInput) => ({
  name: it.name,
  category: it.category ?? null,
  disabled: it.disabled ?? false,
  rarity: it.rarity ?? null,
  imageUrl: it.imageUrl ?? null,
});

/** Edit a DRAFT: name, duration, cap, start delay, and (replace) items. Under the round FOR UPDATE lock. */
export async function updateDraft(
  tx: Tx,
  id: number,
  patch: {
    name?: string;
    durationSec?: number;
    winCap?: number;
    startDelaySec?: number;
    items?: ItemInput[];
  },
  actorId: string,
  requestId?: string,
): Promise<RoundRow> {
  await withRoundLock(tx, id, 'UPDATE');
  const r = await readRoundOrThrow(tx, id);
  if (r.status !== 'DRAFT') throw new AppError('ROUND_NOT_DRAFT', 409, 'Only a draft round can be edited');
  const { items, ...fields } = patch;
  if (r.type === 'QUEUE_RANKED' && fields.winCap !== undefined) {
    throw new AppError('VALIDATION_ERROR', 422, 'winCap applies to live-claim rounds only');
  }
  if (items) assertCategoriesForType(r.type, items);
  if (Object.keys(fields).length > 0) {
    await tx.auctionRound.update({ where: { id }, data: fields });
  }
  if (items) {
    await tx.auctionItem.deleteMany({ where: { roundId: id } });
    await tx.auctionItem.createMany({
      data: items.map((it, i) => ({ roundId: id, ...itemData(it), sortOrder: i })),
    });
  }
  await record(tx, {
    actorType: 'MEMBER',
    actorId,
    action: 'auction.round.update',
    entityType: 'auction_round',
    entityId: String(id),
    meta: { fields: Object.keys(fields), items: items?.length ?? null },
    requestId,
  });
  return readRoundOrThrow(tx, id);
}

/**
 * Closes an OPEN round whose window ended (lazy finalize and the sweeper both call this, design 7.1).
 * Takes the round FOR UPDATE, so it waits for in-flight claims (FOR SHARE); later claims see the round CLOSED.
 * Type-2 allocation (WP9) hooks in here. Returns true when this call closed it.
 */
export async function finalizeRound(tx: Tx, id: number): Promise<boolean> {
  await withRoundLock(tx, id, 'UPDATE');
  const rows = await tx.$queryRaw<{ id: number }[]>`
    UPDATE "AuctionRound" SET status = 'CLOSED', "closedAt" = "closesAt"
    WHERE id = ${id} AND status = 'OPEN' AND "closesAt" <= clock_timestamp()
    RETURNING id`;
  if (rows.length === 0) return false;
  // Type 2: allocation runs in this same transaction (idempotent through allocatedAt).
  const round = await readRoundOrThrow(tx, id);
  if (round.type === 'QUEUE_RANKED') await allocateRound(tx, round);
  return true;
}

/**
 * The submit/claim gate (design 7.1, 7.2, B2): the round row FOR SHARE, then the window is checked DB-side after
 * any lock wait. Finalize and admin close take FOR UPDATE, so a write that passed this gate always finishes before
 * they read the round's inputs, and later writers see CLOSED.
 */
export async function openWindow(
  tx: Tx,
  roundId: number,
  type: RoundRow['type'],
): Promise<{ winCap: number | null }> {
  await withRoundLock(tx, roundId, 'SHARE');
  const [g] = await tx.$queryRaw<
    { type: string; status: string; winCap: number | null; early: boolean; late: boolean }[]
  >`
    SELECT type, status, "winCap",
           ("opensAt" IS NOT NULL AND clock_timestamp() < "opensAt") AS early,
           ("closesAt" IS NOT NULL AND clock_timestamp() > "closesAt") AS late
    FROM "AuctionRound" WHERE id = ${roundId}`;
  if (g!.type !== type) {
    throw new AppError(
      'ROUND_TYPE_MISMATCH',
      409,
      `This is not a ${type === 'LIVE_CLAIM' ? 'live-claim' : 'queue'} round`,
    );
  }
  // A draft is invisible to members (404 on reads), so the write paths must not reveal it either (review L-5).
  if (g!.status === 'DRAFT') throw new AppError('NOT_FOUND', 404, 'Round not found');
  if (g!.status !== 'OPEN' || g!.late) throw new AppError('ROUND_CLOSED', 409, 'The round is closed');
  if (g!.early) throw new AppError('ROUND_NOT_OPEN', 409, 'The round has not opened yet');
  return { winCap: g!.winCap };
}

/** Ids of OPEN rounds whose window has ended (optionally of one type). */
export async function expiredOpenRounds(db: Db, type?: RoundRow['type']): Promise<number[]> {
  const rows = type
    ? await db.$queryRaw<{ id: number }[]>`
        SELECT id FROM "AuctionRound" WHERE status = 'OPEN' AND "closesAt" <= clock_timestamp() AND type = ${type}::"AuctionType" ORDER BY id`
    : await db.$queryRaw<{ id: number }[]>`
        SELECT id FROM "AuctionRound" WHERE status = 'OPEN' AND "closesAt" <= clock_timestamp() ORDER BY id`;
  return rows.map((r) => r.id);
}

export async function startRound(
  tx: Tx,
  id: number,
  o: { startDelaySec?: number; durationSec?: number },
  actorId: string,
  requestId?: string,
): Promise<RoundRow> {
  await withRoundLock(tx, id, 'UPDATE');
  const r = await readRoundOrThrow(tx, id);
  if (r.status !== 'DRAFT') throw new AppError('ROUND_NOT_DRAFT', 409, 'Only a draft round can be started');
  const [cnt] = await tx.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM "AuctionItem" WHERE "roundId" = ${id}`;
  if (cnt!.n === 0) throw new AppError('ROUND_EMPTY', 409, 'A round needs at least one item');
  // A stale OPEN round (window over, not yet swept) must not block the next round.
  for (const stale of await expiredOpenRounds(tx, r.type)) if (stale !== id) await finalizeRound(tx, stale);
  const [other] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "AuctionRound" WHERE type = ${r.type}::"AuctionType" AND status = 'OPEN' AND id <> ${id} LIMIT 1`;
  if (other)
    throw new AppError('ANOTHER_ROUND_OPEN', 409, 'Another round of this type is already open', {
      roundId: other.id,
    });

  const delay = o.startDelaySec ?? r.startDelaySec;
  const duration = o.durationSec ?? r.durationSec;
  let cutoffCategories: string[] = [];
  if (r.type === 'QUEUE_RANKED') {
    // Inside the category locks (after the round lock, sorted), so the cutoff is a consistent queue cut:
    // entries with id <= cutoff are eligible, joins during the window get bigger ids.
    const cats = await tx.$queryRaw<{ category: string }[]>`
      SELECT DISTINCT category::text AS category FROM "AuctionItem"
      WHERE "roundId" = ${id} AND category IS NOT NULL AND NOT disabled`;
    cutoffCategories = cats.map((c) => c.category).sort();
    await categoryLocks(tx, cutoffCategories);
  }
  try {
    // opensAt and closesAt come from ONE clock_timestamp() reading, DB side.
    await tx.$executeRaw`
      WITH c AS (SELECT clock_timestamp() + make_interval(secs => ${delay}::double precision) AS t)
      UPDATE "AuctionRound" r
      SET status = 'OPEN', "durationSec" = ${duration}::int, "startDelaySec" = ${delay}::int,
          "opensAt" = c.t, "closesAt" = c.t + make_interval(secs => ${duration}::double precision)
      FROM c WHERE r.id = ${id} AND r.status = 'DRAFT'`;
  } catch (err) {
    if (isUniqueViolation(err, 'one_open_per_type', '"type"', '(type)')) {
      throw new AppError('ANOTHER_ROUND_OPEN', 409, 'Another round of this type is already open');
    }
    throw err;
  }
  for (const category of cutoffCategories) {
    await tx.$executeRaw`
      INSERT INTO "RoundQueueCutoff" ("roundId", category, "cutoffId")
      VALUES (${id}, ${category}::"ItemCategory",
              COALESCE((SELECT max(id) FROM "QueueEntry" WHERE category = ${category}::"ItemCategory"), 0))`;
  }
  const started = await readRoundOrThrow(tx, id);
  await record(tx, {
    actorType: 'MEMBER',
    actorId,
    action: 'auction.round.start',
    entityType: 'auction_round',
    entityId: String(id),
    meta: {
      opensAt: started.opensAt,
      closesAt: started.closesAt,
      durationSec: duration,
      startDelaySec: delay,
    },
    requestId,
  });
  return started;
}

/**
 * Early close (FR-2.11) under the round FOR UPDATE lock: it waits for in-flight claims, and afterwards every
 * claim sees CLOSED, so no claim can commit after this returned. closesAt is pulled to now, never extended.
 * Closing a CLOSED round is a no-op.
 */
export async function closeRound(tx: Tx, id: number, actorId: string, requestId?: string): Promise<RoundRow> {
  await withRoundLock(tx, id, 'UPDATE');
  const r = await readRoundOrThrow(tx, id);
  if (r.status === 'CLOSED') return r;
  if (r.status === 'CANCELLED') throw new AppError('ROUND_CLOSED', 409, 'The round was cancelled');
  if (r.status !== 'OPEN') throw new AppError('ROUND_NOT_OPEN', 409, 'Only an open round can be closed');
  await tx.$executeRaw`
    UPDATE "AuctionRound"
    SET status = 'CLOSED', "closesAt" = LEAST("closesAt", clock_timestamp()), "closedAt" = clock_timestamp()
    WHERE id = ${id}`;
  // Type 2: an early close allocates in the same transaction (design 6.7); results are published at close.
  if (r.type === 'QUEUE_RANKED') await allocateRound(tx, r, requestId);
  await record(tx, {
    actorType: 'MEMBER',
    actorId,
    action: 'auction.round.close',
    entityType: 'auction_round',
    entityId: String(id),
    requestId,
  });
  return readRoundOrThrow(tx, id);
}

export async function cancelRound(
  tx: Tx,
  id: number,
  actorId: string,
  requestId?: string,
): Promise<RoundRow> {
  await withRoundLock(tx, id, 'UPDATE');
  const r = await readRoundOrThrow(tx, id);
  if (r.status === 'CANCELLED') return r;
  if (r.status === 'CLOSED') throw new AppError('ROUND_CLOSED', 409, 'A closed round cannot be cancelled');
  await tx.$executeRaw`
    UPDATE "AuctionRound" SET status = 'CANCELLED', "closedAt" = clock_timestamp() WHERE id = ${id}`;
  await record(tx, {
    actorType: 'MEMBER',
    actorId,
    action: 'auction.round.cancel',
    entityType: 'auction_round',
    entityId: String(id),
    meta: { from: r.status },
    requestId,
  });
  return readRoundOrThrow(tx, id);
}
