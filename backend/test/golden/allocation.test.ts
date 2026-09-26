import { describe, expect, it } from 'vitest';
import { allocate } from '../../src/modules/auctions/allocation.js';
import { replayAllocation } from '../../src/modules/auctions/replay.js';
import { api, joinInOrder, openQueueRound, queueApi, queueOrder, session } from '../auctions/helpers.js';
import { useWorld } from '../helpers/world.js';

describe('allocate() is pure and matches the requirements (AC-4)', () => {
  const gear = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, category: 'GEAR' }));

  it('golden: queue A..E, lists A=(1,3) B=(1,3) C=(3,2) give A:1, B:3, C:2', () => {
    const awards = allocate(
      { GEAR: ['A', 'B', 'C', 'D', 'E'] },
      gear(5),
      new Map([
        ['A', [1, 3]],
        ['B', [1, 3]],
        ['C', [3, 2]],
      ]),
    );
    expect(awards).toEqual([
      { itemId: 1, memberId: 'A', category: 'GEAR', position: 1 },
      { itemId: 3, memberId: 'B', category: 'GEAR', position: 2 },
      { itemId: 2, memberId: 'C', category: 'GEAR', position: 3 },
    ]);
  });

  it('is deterministic: the same inputs give identical output, and inputs are not mutated', () => {
    const queues = { GEAR: ['A', 'B', 'C'] };
    const prefs = new Map([
      ['A', [2, 1]],
      ['B', [2]],
      ['C', [1, 2, 3]],
    ]);
    const items = gear(3);
    const snapshot = JSON.stringify([queues, [...prefs], items]);
    const first = allocate(queues, items, prefs);
    for (let i = 0; i < 20; i++) expect(allocate(queues, items, prefs)).toEqual(first);
    expect(JSON.stringify([queues, [...prefs], items])).toBe(snapshot);
  });

  it('a member never wins more than one item per category and never an unlisted item', () => {
    const awards = allocate({ GEAR: ['A'] }, gear(4), new Map([['A', [3, 1, 2]]]));
    expect(awards).toEqual([{ itemId: 3, memberId: 'A', category: 'GEAR', position: 1 }]);
    expect(allocate({ GEAR: ['A', 'B'] }, gear(4), new Map([['A', [1]]])).map((a) => a.memberId)).toEqual([
      'A',
    ]);
  });

  it('one win per category: a member with a list spanning categories wins one in each', () => {
    const items = [
      { id: 1, category: 'GEAR' },
      { id: 2, category: 'GEAR' },
      { id: 3, category: 'CARD' },
      { id: 4, category: 'CARD' },
      { id: 5, category: 'RELIC' },
    ];
    const awards = allocate(
      { GEAR: ['A', 'B'], CARD: ['B', 'A'], RELIC: ['A'] },
      items,
      new Map([
        ['A', [1, 2, 3, 5]],
        ['B', [1, 4, 3]],
      ]),
    );
    const by = (m: string) => awards.filter((a) => a.memberId === m).map((a) => `${a.category}:${a.itemId}`);
    expect(by('A')).toEqual(['CARD:3', 'GEAR:1', 'RELIC:5']); // categories are visited in a fixed order
    expect(by('B')).toEqual(['CARD:4']); // B is first in CARD (wants 4 first), loses GEAR 1 to A
  });

  it('a queue shorter than the item list leaves items unawarded; a longer queue leaves members without items', () => {
    expect(allocate({ GEAR: ['A'] }, gear(5), new Map([['A', [1, 2]]]))).toHaveLength(1);
    const many = ['A', 'B', 'C', 'D', 'E'];
    const awards = allocate(
      { GEAR: many },
      gear(2),
      new Map(many.map((m) => [m, [1, 2]] as [string, number[]])),
    );
    expect(awards.map((a) => [a.memberId, a.itemId])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('ignores lists of members who are not in the snapshot (left the queue, joined late)', () => {
    const awards = allocate(
      { GEAR: ['A'] },
      gear(2),
      new Map([
        ['X', [1]],
        ['A', [2]],
      ]),
    );
    expect(awards).toEqual([{ itemId: 2, memberId: 'A', category: 'GEAR', position: 1 }]);
  });

  it('items of a category nobody queued for stay unawarded; an empty queue map works', () => {
    expect(allocate({}, gear(3), new Map([['A', [1]]]))).toEqual([]);
  });
});

describe('golden test end to end (FR-3.7 to FR-3.13)', () => {
  const w = useWorld();
  const A = api(w);
  const Q = queueApi(w);

  it('queue A..E, lists A=(1,3), B=(1,3), C=(3,2): results A:1 B:3 C:2, queue after D,E (winners out), items 4 and 5 stay unallocated with no leftover round', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, c, d, e] = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((ign) => session(w, { ign })));
    const names = new Map([a!, b!, c!, d!, e!].map((m) => [m.id, m.ign]));
    await joinInOrder(w, [a!, b!, c!, d!, e!], 'GEAR');

    const r = await openQueueRound(
      w,
      admin,
      [1, 2, 3, 4, 5].map((n) => ({ name: `Gear ${n}`, category: 'GEAR' as const })),
    );
    const [i1, i2, i3, i4, i5] = r.itemIds as [number, number, number, number, number];
    expect((await Q.setPrefs(a!.h, r.id, [i1, i3])).statusCode).toBe(200);
    expect((await Q.setPrefs(b!.h, r.id, [i1, i3])).statusCode).toBe(200);
    expect((await Q.setPrefs(c!.h, r.id, [i3, i2])).statusCode).toBe(200);
    // D and E list nothing

    expect((await A.close(admin.h, r.id)).json().status).toBe('CLOSED');

    const res = (await A.results(a!.h, r.id)).json();
    const winners = Object.fromEntries(
      res.items.map((it: { id: number; winner: { memberId: string; queuePos: number } | null }) => [
        it.id,
        it.winner ? `${names.get(it.winner.memberId)}@${it.winner.queuePos}` : null,
      ]),
    );
    expect(winners).toEqual({ [i1]: 'A@1', [i2]: 'C@3', [i3]: 'B@2', [i4]: null, [i5]: null });

    // queue after allocation: D, E (winners A, B, C are taken out of the GEAR queue)
    const after = await queueOrder(w, 'GEAR');
    expect(after.map((id) => names.get(id))).toEqual(['D', 'E']);
    const seen = (await Q.queues(d!.h)).json().find((q: { category: string }) => q.category === 'GEAR');
    expect(seen.entries.map((x: { memberId: string }) => names.get(x.memberId))).toEqual(['D', 'E']);
    expect(seen.myRank).toBe(1);
    expect(
      (await Q.queues(c!.h)).json().find((q: { category: string }) => q.category === 'GEAR').myRank,
    ).toBeNull();

    // items 4 and 5 stay in this round without a winner: a queue round makes no leftover round
    expect(res.leftoverRoundId).toBeNull();
    expect(await w.db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } })).toBe(0);

    // stored inputs and a replay from them reproduce the stored results
    const snap = await w.db.prisma.roundQueueSnapshot.findMany({
      where: { roundId: r.id },
      orderBy: { position: 'asc' },
    });
    expect(snap.map((s) => [names.get(s.memberId), s.position])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
      ['D', 4],
      ['E', 5],
    ]);
    const replay = await replayAllocation(w.db.prisma, r.id);
    expect(replay.matches).toBe(true);
    expect(replay.stored).toHaveLength(3);
    const round = await w.db.prisma.auctionRound.findUniqueOrThrow({ where: { id: r.id } });
    expect(round).toMatchObject({ status: 'CLOSED', algorithmVersion: 1 });
    expect(round.allocatedAt).not.toBeNull();
    const audit = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'auction.allocation' } });
    expect(audit.meta).toMatchObject({ algorithmVersion: 1, unallocatedItems: [i4, i5] });
  });
});
