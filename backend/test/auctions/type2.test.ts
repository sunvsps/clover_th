import { describe, expect, it } from 'vitest';
import { replayAllocation } from '../../src/modules/auctions/replay.js';
import { createSweeper } from '../../src/modules/auctions/sweeper.js';
import { allocateRound } from '../../src/modules/auctions/finalizer.js';
import { finalizeRound, readRoundOrThrow } from '../../src/modules/auctions/rounds.js';
import { useWorld } from '../helpers/world.js';
import {
  api,
  joinInOrder,
  openQueueRound,
  queueApi,
  queueOrder,
  session,
  sessions,
  setWindow,
  type Cat,
} from './helpers.js';

const w = useWorld();
const A = api(w);
const Q = queueApi(w);
const gear = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Gear ${i + 1}`, category: 'GEAR' as Cat }));
const stored = async (roundId: number) =>
  (await w.db.prisma.auctionItem.findMany({ where: { roundId }, orderBy: { id: 'asc' } })).map(
    (i) => i.winnerId,
  );

describe('WP9 queue rounds: creation and start', () => {
  it('type-2 rounds take Gear/Card/Relic only (INVALID_CATEGORY_FOR_TYPE), no winCap, and drafts are editable', async () => {
    const admin = await session(w, { admin: true });
    const bad = await A.create(admin.h, {
      type: 'QUEUE_RANKED',
      name: 'x',
      items: [{ name: 'p', category: 'PET' }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('INVALID_CATEGORY_FOR_TYPE');
    expect(
      (await A.create(admin.h, { type: 'QUEUE_RANKED', name: 'x', winCap: 3, items: gear(1) })).statusCode,
    ).toBe(422);
    const ok = await A.create(admin.h, { type: 'QUEUE_RANKED', name: 'Queue', items: gear(2) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ type: 'QUEUE_RANKED', status: 'DRAFT', winCap: null });
    const id = ok.json().id;
    expect(
      (await A.patch(admin.h, id, { items: [{ name: 'p', category: 'GEMBOX' }] })).json().error.code,
    ).toBe('INVALID_CATEGORY_FOR_TYPE');
    expect((await A.patch(admin.h, id, { winCap: 2 })).statusCode).toBe(422);
    expect((await A.patch(admin.h, id, { items: [{ name: 'c', category: 'CARD' }] })).statusCode).toBe(200);
  });

  it('start records a cutoff per category present in the round (max entry id), and a type-2 and a type-1 round can be open together', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [a!, b!], 'GEAR');
    await joinInOrder(w, [b!], 'CARD');
    const maxGear = Math.max(
      ...(await w.db.prisma.queueEntry.findMany({ where: { category: 'GEAR' } })).map((e) => e.id),
    );
    const r = await openQueueRound(w, admin, [...gear(1), { name: 'Card 1', category: 'CARD' }]);
    const cutoffs = await w.db.prisma.roundQueueCutoff.findMany({
      where: { roundId: r.id },
      orderBy: { category: 'asc' },
    });
    expect(cutoffs.map((c) => c.category)).toEqual(['GEAR', 'CARD']); // enum order; no RELIC: not in the round
    expect(cutoffs.find((c) => c.category === 'GEAR')!.cutoffId).toBe(maxGear);
    // a live-claim round can run alongside (one OPEN per TYPE)
    const t1 = (
      await A.create(admin.h, { type: 'LIVE_CLAIM', name: 't1', items: [{ name: 'i', category: 'PET' }] })
    ).json();
    expect((await A.start(admin.h, t1.id)).statusCode).toBe(200);
    // a second type-2 round cannot
    const second = (await A.create(admin.h, { type: 'QUEUE_RANKED', name: 's', items: gear(1) })).json();
    expect((await A.start(admin.h, second.id)).json().error.code).toBe('ANOTHER_ROUND_OPEN');
  });

  it('a claim on a queue round gives ROUND_TYPE_MISMATCH; preferences on a live-claim round too', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    const q = await openQueueRound(w, admin, gear(2));
    expect((await A.claim(a!.h, q.id, q.itemIds[0]!)).json().error.code).toBe('ROUND_TYPE_MISMATCH');
    await A.close(admin.h, q.id);
    const t1 = (
      await A.create(admin.h, { type: 'LIVE_CLAIM', name: 't1', items: [{ name: 'i', category: 'GEAR' }] })
    ).json();
    await A.start(admin.h, t1.id, { startDelaySec: 0 });
    const item = (await w.db.prisma.auctionItem.findFirstOrThrow({ where: { roundId: t1.id } })).id;
    expect((await Q.setPrefs(a!.h, t1.id, [item])).json().error.code).toBe('ROUND_TYPE_MISMATCH');
  });
});

describe('WP9 preferences', () => {
  it('a member in the queue at start can list items; the list is replaced by a new submit; [] clears it', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r = await openQueueRound(w, admin, gear(4));
    expect((await Q.setPrefs(a!.h, r.id, [r.itemIds[2]!, r.itemIds[0]!])).json().itemIds).toEqual([
      r.itemIds[2],
      r.itemIds[0],
    ]);
    expect((await Q.myPrefs(a!.h, r.id)).json().itemIds).toEqual([r.itemIds[2], r.itemIds[0]]);
    await Q.setPrefs(a!.h, r.id, [r.itemIds[1]!]);
    expect((await Q.myPrefs(a!.h, r.id)).json().itemIds).toEqual([r.itemIds[1]]);
    expect((await Q.setPrefs(a!.h, r.id, [])).json().itemIds).toEqual([]);
    expect(await w.db.prisma.preference.count({ where: { roundId: r.id } })).toBe(0);
    // ranks are dense 1..n in stored form
    await Q.setPrefs(a!.h, r.id, [r.itemIds[3]!, r.itemIds[1]!, r.itemIds[0]!]);
    expect(
      (await w.db.prisma.preference.findMany({ where: { roundId: r.id }, orderBy: { rank: 'asc' } })).map(
        (p) => p.rank,
      ),
    ).toEqual([1, 2, 3]);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.preferences.submit' } })).toBe(4);
  });

  it('only eligible items: not in that queue, joined during the window, or left and rejoined => NOT_ELIGIBLE_FOR_CATEGORY', async () => {
    const admin = await session(w, { admin: true });
    const [inQ, none, late, rejoin, other] = await sessions(w, 5);
    await joinInOrder(w, [inQ!, rejoin!], 'GEAR');
    await joinInOrder(w, [other!], 'CARD');
    const r = await openQueueRound(w, admin, [...gear(2), { name: 'Card 1', category: 'CARD' }]);
    const [g1, g2, c1] = r.itemIds as [number, number, number];
    await Q.join(late!.h, 'GEAR'); // during the window: tail, not eligible
    await Q.leave(rejoin!.h, 'GEAR');
    await Q.join(rejoin!.h, 'GEAR'); // rejoin during the window: new id, not eligible
    for (const m of [none!, late!, rejoin!]) {
      const res = await Q.setPrefs(m.h, r.id, [g1]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: 'NOT_ELIGIBLE_FOR_CATEGORY',
        details: { category: 'GEAR' },
      });
    }
    expect((await Q.setPrefs(inQ!.h, r.id, [g1, g2])).statusCode).toBe(200);
    // a GEAR-only member cannot list the CARD item; the CARD member cannot list GEAR
    expect((await Q.setPrefs(inQ!.h, r.id, [g1, c1])).json().error.details.category).toBe('CARD');
    expect((await Q.setPrefs(other!.h, r.id, [g1])).json().error.code).toBe('NOT_ELIGIBLE_FOR_CATEGORY');
    expect((await Q.setPrefs(other!.h, r.id, [c1])).statusCode).toBe(200);
    // the rejected submits stored nothing
    expect(
      await w.db.prisma.preference.count({ where: { memberId: { in: [none!.id, late!.id, rejoin!.id] } } }),
    ).toBe(0);
    // eligibility is also exposed on the round view
    expect((await A.get(inQ!.h, r.id)).json().eligibleCategories).toEqual(['GEAR']);
    expect((await A.get(late!.h, r.id)).json().eligibleCategories).toEqual([]);
  });

  it('invalid lists: duplicates, unknown items and items of another round give INVALID_PREFERENCE_LIST; nothing changes', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const other = await openQueueRound(w, admin, gear(1));
    await A.close(admin.h, other.id);
    const r = await openQueueRound(w, admin, gear(3));
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    for (const list of [[r.itemIds[0]!, r.itemIds[0]!], [999999], [other.itemIds[0]!]]) {
      const res = await Q.setPrefs(a!.h, r.id, list);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('INVALID_PREFERENCE_LIST');
    }
    expect((await Q.myPrefs(a!.h, r.id)).json().itemIds).toEqual([r.itemIds[0]]);
    expect((await Q.setPrefs(a!.h, r.id, [0] as never)).statusCode).toBe(422);
  });

  it('window rules: before opensAt ROUND_NOT_OPEN, after close/expiry ROUND_CLOSED, draft ROUND_NOT_OPEN', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    await setWindow(w, r.id, '30 seconds', '330 seconds');
    expect((await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!])).json().error.code).toBe('ROUND_NOT_OPEN');
    await setWindow(w, r.id, '-10 seconds', '-1 second');
    expect((await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!])).json().error.code).toBe('ROUND_CLOSED');
    const d = (await A.create(admin.h, { type: 'QUEUE_RANKED', name: 'd', items: gear(1) })).json();
    const di = (await w.db.prisma.auctionItem.findFirstOrThrow({ where: { roundId: d.id } })).id;
    // a draft is invisible to members, so writes do not reveal it either (security review L-5)
    expect((await Q.setPrefs(a!.h, d.id, [di])).statusCode).toBe(404);
  });

  it('a preference edit after close gives ROUND_CLOSED and the stored list stays as it was', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await A.close(admin.h, r.id);
    const late = await Q.setPrefs(a!.h, r.id, [r.itemIds[1]!]);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ROUND_CLOSED');
    expect((await Q.setPrefs(a!.h, r.id, [])).json().error.code).toBe('ROUND_CLOSED');
    expect((await Q.myPrefs(a!.h, r.id)).json().itemIds).toEqual([r.itemIds[0]]);
  });

  it('preference lists are private: members read only their own; admins read all; the admin route refuses members', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [a!, b!], 'GEAR');
    const r = await openQueueRound(w, admin, gear(3));
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!, r.itemIds[1]!]);
    await Q.setPrefs(b!.h, r.id, [r.itemIds[2]!]);
    expect((await Q.myPrefs(b!.h, r.id)).json().itemIds).toEqual([r.itemIds[2]]);
    const denied = await Q.adminPrefs(a!.h, r.id);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ADMIN_REQUIRED');
    const all = (await Q.adminPrefs(admin.h, r.id)).json();
    expect(all.lists.find((l: { memberId: string }) => l.memberId === a!.id).itemIds).toEqual([
      r.itemIds[0],
      r.itemIds[1],
    ]);
    expect(all.lists).toHaveLength(2);
    // the round view and results never contain anyone's list
    expect(JSON.stringify((await A.get(b!.h, r.id)).json())).not.toContain('itemIds');
    await A.close(admin.h, r.id);
    expect((await Q.myPrefs(a!.h, r.id)).json().itemIds).toEqual([r.itemIds[0], r.itemIds[1]]); // still readable to the owner after close
    expect(JSON.stringify((await A.results(b!.h, r.id)).json())).not.toContain(
      `${r.itemIds[0]},${r.itemIds[1]}`,
    );
  });
});

describe('WP9 allocation through the API', () => {
  it('multi-category round: a member can win one item per category, never two in one category', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    for (const c of ['GEAR', 'CARD', 'RELIC'] as const) await joinInOrder(w, [a!, b!], c);
    const r = await openQueueRound(w, admin, [
      { name: 'G1', category: 'GEAR' },
      { name: 'G2', category: 'GEAR' },
      { name: 'C1', category: 'CARD' },
      { name: 'R1', category: 'RELIC' },
      { name: 'R2', category: 'RELIC' },
    ]);
    const [g1, g2, c1, r1, r2] = r.itemIds as number[] as [number, number, number, number, number];
    await Q.setPrefs(a!.h, r.id, [g1, g2, c1, r1, r2]); // wants everything
    await Q.setPrefs(b!.h, r.id, [c1, g1, r2]);
    await A.close(admin.h, r.id);
    const won = await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id }, orderBy: { id: 'asc' } });
    const by = (m: string) => won.filter((i) => i.winnerId === m).map((i) => i.category);
    expect(by(a!.id).sort()).toEqual(['CARD', 'GEAR', 'RELIC']); // one per category
    expect(by(b!.id)).toEqual(['RELIC']); // B: GEAR g1 and CARD c1 went to A (first in queue); only r2 left
    expect(won.map((i) => i.winnerId)).toEqual([a!.id, null, a!.id, a!.id, b!.id]);
    expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(true);
    // every winner re-queued behind non-winners, per category
    expect(await queueOrder(w, 'GEAR')).toEqual([b!.id, a!.id]);
    expect(await queueOrder(w, 'CARD')).toEqual([b!.id, a!.id]);
    expect(await queueOrder(w, 'RELIC')).toEqual([a!.id, b!.id]);
  });

  it('two members with the same first choice: the earlier in queue wins it, the other falls to the next item', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [b!, a!], 'GEAR'); // B is first
    const r = await openQueueRound(w, admin, gear(3));
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!, r.itemIds[1]!]);
    await Q.setPrefs(b!.h, r.id, [r.itemIds[0]!, r.itemIds[2]!]);
    await A.close(admin.h, r.id);
    expect(await stored(r.id)).toEqual([b!.id, a!.id, null]);
  });

  it('a queue shorter than the items leaves items over; a longer queue leaves members without an item', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 4);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    for (const m of ms) await Q.setPrefs(m.h, r.id, [r.itemIds[0]!, r.itemIds[1]!]);
    await A.close(admin.h, r.id);
    expect(await stored(r.id)).toEqual([ms[0]!.id, ms[1]!.id]);
    expect(await queueOrder(w, 'GEAR')).toEqual([ms[2]!.id, ms[3]!.id, ms[0]!.id, ms[1]!.id]);
    expect((await A.results(ms[0]!.h, r.id)).json().leftoverRoundId).toBeNull(); // no leftovers: every item was won

    const short = await session(w);
    await Q.join(short.h, 'CARD');
    const r2 = await openQueueRound(
      w,
      admin,
      [1, 2, 3, 4, 5].map((n) => ({ name: `C${n}`, category: 'CARD' as Cat })),
    );
    await Q.setPrefs(short.h, r2.id, [r2.itemIds[0]!, r2.itemIds[1]!]);
    await A.close(admin.h, r2.id);
    expect((await stored(r2.id)).filter(Boolean)).toHaveLength(1); // one member: one item
    const res = (await A.results(short.h, r2.id)).json();
    expect(await w.db.prisma.auctionItem.count({ where: { roundId: res.leftoverRoundId } })).toBe(4);
  });

  it('a member who submitted nothing, or whose items were all taken, keeps their position; latecomers stay ahead of new winners', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, c, d, latecomer] = await sessions(w, 5);
    await joinInOrder(w, [a!, b!, c!, d!], 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    await Q.join(latecomer!.h, 'GEAR'); // during the window
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await Q.setPrefs(b!.h, r.id, [r.itemIds[0]!]); // all taken by A
    await Q.setPrefs(latecomer!.h, r.id, [r.itemIds[1]!]).then((x) => expect(x.statusCode).toBe(409));
    // c submitted nothing, d empty list
    await Q.setPrefs(d!.h, r.id, []);
    await A.close(admin.h, r.id);
    expect(await stored(r.id)).toEqual([a!.id, null]);
    // non-winners keep their relative order in front, the latecomer joined before the requeue so stays ahead of winner A
    expect(await queueOrder(w, 'GEAR')).toEqual([b!.id, c!.id, d!.id, latecomer!.id, a!.id]);
  });

  it('a member who left the queue during the window is not in the snapshot; their earlier list is ignored', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, c] = await sessions(w, 3);
    await joinInOrder(w, [a!, b!, c!], 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await Q.setPrefs(b!.h, r.id, [r.itemIds[0]!]);
    await Q.leave(a!.h, 'GEAR'); // A had listed, then left: ineligible
    await Q.join(a!.h, 'GEAR'); // and rejoined at the tail: still ineligible
    await A.close(admin.h, r.id);
    expect(await stored(r.id)).toEqual([b!.id, null]);
    const snap = await w.db.prisma.roundQueueSnapshot.findMany({
      where: { roundId: r.id },
      orderBy: { position: 'asc' },
    });
    expect(snap.map((s) => s.memberId)).toEqual([b!.id, c!.id]);
    expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(true);
    expect(await queueOrder(w, 'GEAR')).toEqual([c!.id, a!.id, b!.id]);
  });

  it('leftovers include items nobody listed AND items whose listers all lost out, in ONE draft type-1 round (never opened)', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 2);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(4));
    await Q.setPrefs(ms[0]!.h, r.id, [r.itemIds[0]!]);
    await Q.setPrefs(ms[1]!.h, r.id, [r.itemIds[0]!]); // loses item 1; nothing else listed
    await A.close(admin.h, r.id);
    const res = (await A.results(ms[0]!.h, r.id)).json();
    const left = await w.db.prisma.auctionRound.findUniqueOrThrow({
      where: { id: res.leftoverRoundId },
      include: { items: true },
    });
    expect(left.items.map((i) => i.name).sort()).toEqual(['Gear 2', 'Gear 3', 'Gear 4']);
    expect(left).toMatchObject({ status: 'DRAFT', type: 'LIVE_CLAIM', sourceRoundId: r.id });
    // admin reviews and starts it through the normal endpoints; any category is accepted
    expect((await A.start(admin.h, left.id, { startDelaySec: 0 })).statusCode).toBe(200);
    expect((await A.claim(ms[0]!.h, left.id, left.items[0]!.id)).statusCode).toBe(200);
  });

  it('finalize twice is idempotent: identical results, queue, snapshot, one leftover round, one allocation audit row', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 3);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(4));
    await Q.setPrefs(ms[0]!.h, r.id, [r.itemIds[1]!]);
    await Q.setPrefs(ms[1]!.h, r.id, [r.itemIds[1]!, r.itemIds[0]!]);
    await A.close(admin.h, r.id);
    const snapshotOf = async () => ({
      items: await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id }, orderBy: { id: 'asc' } }),
      queue: await queueOrder(w, 'GEAR'),
      snapshot: await w.db.prisma.roundQueueSnapshot.count({ where: { roundId: r.id } }),
      leftovers: await w.db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } }),
      audits: await w.db.prisma.auditLog.count({ where: { action: 'auction.allocation' } }),
    });
    const first = await snapshotOf();
    // every way to trigger finalize again
    expect((await A.close(admin.h, r.id)).statusCode).toBe(200);
    expect(await w.app.tx((t) => finalizeRound(t, r.id))).toBe(false);
    await setWindow(w, r.id, '-10 seconds', '-1 second');
    expect(await createSweeper({ prisma: w.db.prisma, tx: w.app.tx }).tick()).toBe(0);
    await A.get(ms[0]!.h, r.id);
    expect(await snapshotOf()).toEqual(first);
    expect(first).toMatchObject({ snapshot: 3, leftovers: 1, audits: 1 });
  });

  it('the allocation step itself is idempotent (allocatedAt guard): running it again on an allocated round changes nothing', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 3);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(3));
    await Q.setPrefs(ms[0]!.h, r.id, [r.itemIds[0]!]);
    await Q.setPrefs(ms[1]!.h, r.id, [r.itemIds[0]!, r.itemIds[1]!]);
    await A.close(admin.h, r.id);
    const before = { items: await stored(r.id), queue: await queueOrder(w, 'GEAR') };
    const again = await w.app.tx(async (t) => allocateRound(t, await readRoundOrThrow(t, r.id)));
    expect(again).toBe(false);
    expect({ items: await stored(r.id), queue: await queueOrder(w, 'GEAR') }).toEqual(before);
    expect(await w.db.prisma.roundQueueSnapshot.count({ where: { roundId: r.id } })).toBe(3);
    expect(await w.db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } })).toBe(1);
  });

  it('admin close early triggers allocation; expiry (lazy read and sweeper) triggers it too', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r1 = await openQueueRound(w, admin, gear(1));
    await Q.setPrefs(a!.h, r1.id, [r1.itemIds[0]!]);
    expect(
      (await w.db.prisma.auctionRound.findUniqueOrThrow({ where: { id: r1.id } })).allocatedAt,
    ).toBeNull(); // still open
    await A.close(admin.h, r1.id);
    const closed = await w.db.prisma.auctionRound.findUniqueOrThrow({ where: { id: r1.id } });
    expect(closed).toMatchObject({ status: 'CLOSED', algorithmVersion: 1 });
    expect(closed.allocatedAt).not.toBeNull();
    expect(await stored(r1.id)).toEqual([a!.id]);

    const r2 = await openQueueRound(w, admin, gear(1));
    await Q.setPrefs(a!.h, r2.id, [r2.itemIds[0]!]);
    await setWindow(w, r2.id, '-10 seconds', '-1 second');
    expect((await A.results(a!.h, r2.id)).json().items[0].winner.memberId).toBe(a!.id); // lazy finalize on read

    const r3 = await openQueueRound(w, admin, gear(1));
    await Q.setPrefs(a!.h, r3.id, [r3.itemIds[0]!]);
    await setWindow(w, r3.id, '-10 seconds', '-1 second');
    expect(await createSweeper({ prisma: w.db.prisma, tx: w.app.tx }).tick()).toBe(1);
    expect(await stored(r3.id)).toEqual([a!.id]);
    // a winner is re-queued after every allocation and is the only one left in the queue
    expect(await queueOrder(w, 'GEAR')).toEqual([a!.id]);
  });

  it('results: hidden before close, published to everyone after with queuePos and leftoverRoundId; rank stays visible', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, outsider] = await sessions(w, 3);
    await joinInOrder(w, [a!, b!], 'GEAR');
    const r = await openQueueRound(w, admin, gear(2));
    await Q.setPrefs(b!.h, r.id, [r.itemIds[1]!]);
    expect((await A.results(outsider!.h, r.id)).json().error.code).toBe('ROUND_NOT_CLOSED');
    expect((await Q.queues(outsider!.h)).json()[0].length).toBe(2);
    await A.close(admin.h, r.id);
    const res = (await A.results(outsider!.h, r.id)).json();
    expect(res.status).toBe('CLOSED');
    expect(res.items[1].winner).toMatchObject({ memberId: b!.id, queuePos: 2 });
    expect(res.items[0].winner).toBeNull();
    expect(res.leftoverRoundId).not.toBeNull();
    expect((await A.mine(b!.h, r.id)).json()).toMatchObject({ myWinCount: 1 });
    expect((await Q.queues(a!.h)).json()[0].myRank).toBe(1); // A (no win) is now first; B is behind
    expect((await Q.queues(b!.h)).json()[0].myRank).toBe(2);
  });

  it('replay from the stored snapshot equals the stored results; tampering with a result is detected', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 4);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(3));
    await Q.setPrefs(ms[0]!.h, r.id, [r.itemIds[0]!, r.itemIds[1]!]);
    await Q.setPrefs(ms[1]!.h, r.id, [r.itemIds[0]!, r.itemIds[2]!]);
    await Q.setPrefs(ms[3]!.h, r.id, [r.itemIds[2]!]);
    await A.close(admin.h, r.id);
    const ok = await replayAllocation(w.db.prisma, r.id);
    expect(ok).toMatchObject({ matches: true, algorithmVersion: 1 });
    expect(ok.stored.map((x) => x.position)).toEqual([1, 2]);
    // the queue moved on (winners re-queued), yet the replay still uses the frozen snapshot
    expect((await queueOrder(w, 'GEAR'))[0]).toBe(ms[2]!.id);
    await w.db.prisma
      .$executeRaw`UPDATE "AuctionItem" SET "winnerId" = ${ms[3]!.id}::uuid WHERE id = ${r.itemIds[0]!}`;
    expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(false);
  });
});

describe('disabled items in a queue round', () => {
  it('need no category, cannot be ranked (ITEM_DISABLED), and are neither allocated nor copied as leftovers', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r = await openQueueRound(w, admin, [...gear(2), { name: 'off', disabled: true }]);
    const off = r.itemIds[2]!;
    const res = await Q.setPrefs(a!.h, r.id, [off]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ITEM_DISABLED');
    await Q.setPrefs(a!.h, r.id, [r.itemIds[0]!]);
    await A.close(admin.h, r.id);
    expect(await stored(r.id)).toEqual([a!.id, null, null]);
    const leftover = await w.db.prisma.auctionRound.findFirstOrThrow({ where: { sourceRoundId: r.id }, include: { items: true } });
    expect(leftover.items.map((i) => i.name)).toEqual(['Gear 2']);
  });
});
