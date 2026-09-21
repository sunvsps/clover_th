import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { queueApi, queueOrder, session, sessions } from './helpers.js';

const w = useWorld();
const Q = queueApi(w);

describe('WP9 queues (FR-3.1 to FR-3.3)', () => {
  it('join puts you at the tail of that category with a rank; the full order is visible to every member', async () => {
    const [a, b, c] = await sessions(w, 3);
    expect((await Q.join(a!.h, 'GEAR')).json()).toEqual({ category: 'GEAR', length: 1, myRank: 1 });
    expect((await Q.join(b!.h, 'GEAR')).json()).toEqual({ category: 'GEAR', length: 2, myRank: 2 });
    await Q.join(c!.h, 'CARD');
    const view = (await Q.queues(b!.h)).json() as {
      category: string;
      length: number;
      myRank: number | null;
      entries: { rank: number; memberId: string }[];
    }[];
    expect(view.map((v) => v.category)).toEqual(['GEAR', 'CARD', 'RELIC']);
    const gear = view[0]!;
    expect(gear).toMatchObject({ length: 2, myRank: 2 });
    expect(gear.entries.map((e) => [e.rank, e.memberId])).toEqual([
      [1, a!.id],
      [2, b!.id],
    ]);
    expect(view[1]).toMatchObject({ length: 1, myRank: null }); // not in CARD
    expect(view[2]).toMatchObject({ length: 0, myRank: null, entries: [] });
  });

  it('queues are separate per category; a member can be in all three', async () => {
    const [a] = await sessions(w, 1);
    for (const c of ['GEAR', 'CARD', 'RELIC']) expect((await Q.join(a!.h, c)).json().myRank).toBe(1);
    expect((await Q.queues(a!.h)).json().map((q: { myRank: number }) => q.myRank)).toEqual([1, 1, 1]);
  });

  it('join is idempotent and keeps the position; leave removes the entry (and is idempotent)', async () => {
    const [a, b] = await sessions(w, 2);
    await Q.join(a!.h, 'GEAR');
    await Q.join(b!.h, 'GEAR');
    expect((await Q.join(a!.h, 'GEAR')).json().myRank).toBe(1); // unchanged
    expect(await w.db.prisma.queueEntry.count({ where: { category: 'GEAR' } })).toBe(2);
    expect((await Q.leave(a!.h, 'GEAR')).json()).toEqual({ category: 'GEAR', length: 1, myRank: null });
    expect((await Q.leave(a!.h, 'GEAR')).statusCode).toBe(200);
    expect((await Q.queues(b!.h)).json()[0].myRank).toBe(1); // b moved up
  });

  it('leaving loses the position: rejoining goes to the tail', async () => {
    const [a, b, c] = await sessions(w, 3);
    for (const m of [a!, b!, c!]) await Q.join(m.h, 'GEAR');
    await Q.leave(a!.h, 'GEAR');
    expect((await Q.join(a!.h, 'GEAR')).json().myRank).toBe(3);
    expect(await queueOrder(w, 'GEAR')).toEqual([b!.id, c!.id, a!.id]);
  });

  it('only Gear, Card and Relic have queues: others give INVALID_QUEUE_CATEGORY 422', async () => {
    const [a] = await sessions(w, 1);
    for (const c of ['PET', 'MATERIAL', 'GEMBOX', 'gear', 'x']) {
      const r = await Q.join(a!.h, c);
      expect(r.statusCode, c).toBe(422);
      expect(r.json().error.code).toBe('INVALID_QUEUE_CATEGORY');
    }
    expect((await Q.leave(a!.h, 'PET')).json().error.code).toBe('INVALID_QUEUE_CATEGORY');
    expect(await w.db.prisma.queueEntry.count()).toBe(0);
  });

  it('join and leave are audited; unauthenticated calls are 401', async () => {
    const [a] = await sessions(w, 1);
    await Q.join(a!.h, 'RELIC');
    await Q.leave(a!.h, 'RELIC');
    expect(
      (await w.db.prisma.auditLog.findMany({ where: { actorId: a!.id } })).map((x) => x.action).sort(),
    ).toEqual(['queue.join', 'queue.leave']);
    expect((await w.app.inject({ method: 'PUT', url: '/api/v1/auctions/queues/GEAR/me' })).statusCode).toBe(
      401,
    );
  });

  it('deactivating a member removes them from every queue', async () => {
    const [a, b] = await sessions(w, 2);
    for (const m of [a!, b!]) await Q.join(m.h, 'GEAR');
    await Q.join(a!.h, 'CARD');
    const admin = await session(w, { admin: true });
    await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${a!.id}/deactivate`,
      headers: admin.h,
    });
    expect(await queueOrder(w, 'GEAR')).toEqual([b!.id]);
    expect(await queueOrder(w, 'CARD')).toEqual([]);
  });

  it('concurrent joins by 20 members get 20 distinct ranks 1..20 and rank order equals entry-id (commit) order', async () => {
    const ms = await sessions(w, 20);
    const rs = await Promise.all(ms.map((m) => Q.join(m.h, 'GEAR')));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const ranks = rs.map((r) => r.json().myRank as number).sort((x, y) => x - y);
    expect(ranks).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)); // no duplicated rank: joins were serialized
    const order = await queueOrder(w, 'GEAR');
    expect(order).toHaveLength(20);
    // each member's reported rank is their real position in id order
    for (const [i, id] of order.entries()) {
      const idx = ms.findIndex((m) => m.id === id);
      expect(rs[idx]!.json().myRank).toBe(i + 1);
    }
  });

  it('the same member joining 10 times at once creates one entry; join and leave racing leave a consistent state', async () => {
    const [a] = await sessions(w, 1);
    await Promise.all(Array.from({ length: 10 }, () => Q.join(a!.h, 'GEAR')));
    expect(await w.db.prisma.queueEntry.count({ where: { memberId: a!.id } })).toBe(1);
    for (let i = 0; i < 10; i++) {
      const rs = await Promise.all([
        Q.leave(a!.h, 'GEAR'),
        Q.join(a!.h, 'GEAR'),
        Q.leave(a!.h, 'GEAR'),
        Q.join(a!.h, 'GEAR'),
      ]);
      expect(rs.every((r) => r.statusCode === 200)).toBe(true);
      expect(
        await w.db.prisma.queueEntry.count({ where: { memberId: a!.id, category: 'GEAR' } }),
      ).toBeLessThanOrEqual(1);
    }
  });
});
