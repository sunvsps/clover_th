import { describe, expect, it } from 'vitest';
import { replayAllocation } from '../../src/modules/auctions/replay.js';
import { finalizeRound } from '../../src/modules/auctions/rounds.js';
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
const tally = (xs: string[]) =>
  xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const code = (r: { statusCode: number; json: () => { error?: { code: string } } }) =>
  r.statusCode === 200 ? 'OK' : (r.json().error?.code ?? String(r.statusCode));

describe('WP9 concurrency (Promise.all against real Postgres)', () => {
  it('submit racing an admin close: every 200 is part of the stored inputs and wins; every rejection is ROUND_CLOSED and stored nothing', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 16);
    let acceptedTotal = 0;
    let rejectedTotal = 0;
    for (let round = 0; round < 8; round++) {
      // fresh queue each round: everyone re-joins in the same order (winners were re-queued last time)
      await w.db.prisma.queueEntry.deleteMany();
      await joinInOrder(w, ms, 'GEAR');
      const r = await openQueueRound(w, admin, gear(16));
      // member i wants exactly item i: with all-distinct wishes, a member wins iff their submit counted
      const [close, ...subs] = await Promise.all([
        A.close(admin.h, r.id),
        ...ms.map((m, i) => Q.setPrefs(m.h, r.id, [r.itemIds[i]!])),
      ]);
      expect(close.statusCode).toBe(200);
      const codes = subs.map(code);
      expect(codes.every((c) => c === 'OK' || c === 'ROUND_CLOSED')).toBe(true);
      const winners = (
        await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id }, orderBy: { id: 'asc' } })
      ).map((i) => i.winnerId);
      ms.forEach((m, i) => {
        if (codes[i] === 'OK')
          expect(winners[i], `accepted submit of member ${i} must be in the allocation`).toBe(m.id);
        else expect(winners[i], `rejected submit of member ${i} must not win`).toBeNull();
      });
      // and the stored Preference rows are exactly the accepted lists
      expect(await w.db.prisma.preference.count({ where: { roundId: r.id } })).toBe(
        codes.filter((c) => c === 'OK').length,
      );
      expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(true);
      acceptedTotal += codes.filter((c) => c === 'OK').length;
      rejectedTotal += codes.filter((c) => c === 'ROUND_CLOSED').length;
    }
    // sanity: across the rounds the race was actually exercised on at least one side
    expect(acceptedTotal + rejectedTotal).toBe(8 * 16);
  });

  it('submit racing the expiry finalize (sweeper path) behaves the same: accepted means allocated, later means ROUND_CLOSED', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 10);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(10));
    await setWindow(w, r.id, '-10 seconds', '500 milliseconds'); // closes while the submits are in flight
    await new Promise((res) => setTimeout(res, 480));
    const [fin, ...subs] = await Promise.all([
      w.app.tx((t) => finalizeRound(t, r.id)).catch(() => false),
      ...ms.map((m, i) => Q.setPrefs(m.h, r.id, [r.itemIds[i]!])),
    ]);
    void fin;
    await new Promise((res) => setTimeout(res, 100));
    await A.get(ms[0]!.h, r.id); // lazy finalize if the race did not already do it
    const codes = subs.map(code);
    expect(codes.every((c) => c === 'OK' || c === 'ROUND_CLOSED')).toBe(true);
    const winners = (
      await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id }, orderBy: { id: 'asc' } })
    ).map((i) => i.winnerId);
    ms.forEach((m, i) => expect(winners[i] === m.id).toBe(codes[i] === 'OK'));
  });

  it('finalize triggered from many paths at once (10 closes, finalize calls, reads) allocates exactly once', async () => {
    const admin = await session(w, { admin: true });
    const ms = await sessions(w, 6);
    await joinInOrder(w, ms, 'GEAR');
    const r = await openQueueRound(w, admin, gear(4));
    for (const [i, m] of ms.entries()) await Q.setPrefs(m.h, r.id, [r.itemIds[i % 4]!, r.itemIds[0]!]);
    await setWindow(w, r.id, '-10 seconds', '-1 second');
    const rs = await Promise.all([
      ...Array.from({ length: 5 }, () => A.close(admin.h, r.id)),
      ...Array.from({ length: 5 }, () => w.app.tx((t) => finalizeRound(t, r.id))),
      ...ms.map((m) => A.results(m.h, r.id)),
    ]);
    expect(rs.some((x) => (x as { statusCode?: number }).statusCode === 500)).toBe(false);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.allocation' } })).toBe(1);
    expect(await w.db.prisma.roundQueueSnapshot.count({ where: { roundId: r.id } })).toBe(6);
    expect(await w.db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } })).toBeLessThanOrEqual(1);
    expect(new Set(await queueOrder(w, 'GEAR')).size).toBe(6); // nobody duplicated or lost in the queue
    expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(true);
  });

  it('the same member submitting 10 lists at once ends with exactly one complete list (no duplicate-rank errors)', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'GEAR');
    const r = await openQueueRound(w, admin, gear(6));
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => Q.setPrefs(a!.h, r.id, r.itemIds.slice(0, (i % 5) + 1).reverse())),
    );
    expect(tally(rs.map(code))).toEqual({ OK: 10 });
    const rows = await w.db.prisma.preference.findMany({
      where: { roundId: r.id },
      orderBy: { rank: 'asc' },
    });
    expect(rows.map((x) => x.rank)).toEqual(rows.map((_, i) => i + 1)); // dense, one list
  });

  it('join/leave racing the round start and the allocation keep the queue consistent (no duplicates, winners keep their relative order)', async () => {
    const admin = await session(w, { admin: true });
    const base = await sessions(w, 6);
    const extra = await sessions(w, 10, 'Extra');
    await joinInOrder(w, base, 'GEAR');
    const r = await openQueueRound(w, admin, gear(3));
    for (const [i, m] of base.entries()) if (i < 3) await Q.setPrefs(m.h, r.id, [r.itemIds[i]!]);
    // joins and leaves fire while the round closes and allocates
    await Promise.all([
      A.close(admin.h, r.id),
      ...extra.map((m) => Q.join(m.h, 'GEAR')),
      ...base.slice(3).map((m) => Q.leave(m.h, 'GEAR')),
    ]);
    const order = await queueOrder(w, 'GEAR');
    expect(new Set(order).size).toBe(order.length);
    const winners = base.slice(0, 3).map((m) => m.id);
    const idx = winners.map((id) => order.indexOf(id));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx); // A, B, C keep their previous relative order at the tail
    // non-winners that did not leave are still ahead of every winner
    for (const m of base.slice(3))
      if (order.includes(m.id)) expect(order.indexOf(m.id)).toBeLessThan(Math.min(...idx));
    expect((await replayAllocation(w.db.prisma, r.id)).matches).toBe(true);
    const ids = (
      await w.db.prisma.queueEntry.findMany({ where: { category: 'GEAR' }, orderBy: { id: 'asc' } })
    ).map((e) => e.memberId);
    expect(ids).toEqual(order);
  });

  it('a join racing the round START is either inside the cutoff (eligible) or after it (not eligible), never both', async () => {
    const admin = await session(w, { admin: true });
    const joiners = await sessions(w, 12);
    for (let round = 0; round < 4; round++) {
      await w.db.prisma.queueEntry.deleteMany();
      const created = (await A.create(admin.h, { type: 'QUEUE_RANKED', name: 'r', items: gear(2) })).json();
      const [started] = await Promise.all([
        A.start(admin.h, created.id, { startDelaySec: 0 }),
        ...joiners.map((m) => Q.join(m.h, 'GEAR')),
      ]);
      expect(started.statusCode).toBe(200);
      const cutoff = (await w.db.prisma.roundQueueCutoff.findFirstOrThrow({ where: { roundId: created.id } }))
        .cutoffId;
      for (const m of joiners) {
        const entry = await w.db.prisma.queueEntry.findFirstOrThrow({
          where: { memberId: m.id, category: 'GEAR' },
        });
        const view = (await A.get(m.h, created.id)).json();
        expect(view.eligibleCategories.includes('GEAR')).toBe(entry.id <= cutoff);
      }
      await A.close(admin.h, created.id);
    }
  });

  it('two different members submitting and a third leaving the queue at the same time: the leaver is never in the snapshot', async () => {
    const admin = await session(w, { admin: true });
    for (let round = 0; round < 5; round++) {
      await w.db.prisma.queueEntry.deleteMany();
      const [a, b, leaver] = await sessions(w, 3, `Lv${round}x`);
      await joinInOrder(w, [a!, leaver!, b!], 'GEAR');
      const r = await openQueueRound(w, admin, gear(3));
      await Q.setPrefs(leaver!.h, r.id, [r.itemIds[0]!]);
      await Promise.all([
        Q.setPrefs(a!.h, r.id, [r.itemIds[1]!]),
        Q.leave(leaver!.h, 'GEAR'),
        Q.setPrefs(b!.h, r.id, [r.itemIds[2]!]),
      ]);
      await A.close(admin.h, r.id);
      const snap = (await w.db.prisma.roundQueueSnapshot.findMany({ where: { roundId: r.id } })).map(
        (s) => s.memberId,
      );
      expect(snap).not.toContain(leaver!.id);
      const winners = (
        await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id }, orderBy: { id: 'asc' } })
      ).map((i) => i.winnerId);
      expect(winners[0]).toBeNull();
    }
  });
});
