import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import {
  api,
  joinInOrder,
  openQueueRound,
  queueApi,
  queueOrder,
  session,
  sessions,
  type Cat,
} from './helpers.js';

const w = useWorld();
const A = api(w);
const Q = queueApi(w);

describe('queue page: admin remove', () => {
  it('an admin removes a member from one queue; the rest move up and other queues are untouched', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, c] = await sessions(w, 3);
    await joinInOrder(w, [a!, b!, c!], 'GEAR');
    await joinInOrder(w, [a!], 'CARD');
    const r = await Q.remove(admin.h, 'GEAR', a!.id);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ category: 'GEAR', length: 2, myRank: null });
    expect(await queueOrder(w, 'GEAR')).toEqual([b!.id, c!.id]);
    expect(await queueOrder(w, 'CARD')).toEqual([a!.id]);
    expect((await Q.remove(admin.h, 'GEAR', a!.id)).statusCode).toBe(200); // idempotent
    const audit = await w.db.prisma.auditLog.findMany({ where: { action: 'queue.remove' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: admin.id, entityId: 'GEAR', meta: { memberId: a!.id } });
  });

  it('members cannot use it (403); bad category is 422 and a bad member id is 422', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [a!], 'GEAR');
    expect((await Q.remove(b!.h, 'GEAR', a!.id)).statusCode).toBe(403);
    expect(await queueOrder(w, 'GEAR')).toEqual([a!.id]);
    expect((await Q.remove(admin.h, 'PET', a!.id)).json().error.code).toBe('INVALID_QUEUE_CATEGORY');
    expect((await Q.remove(admin.h, 'GEAR', 'not-a-uuid')).statusCode).toBe(422);
  });
});

describe('queue page: history', () => {
  it('lists allocation wins across rounds, newest round first, with round, item, category, member and queue position', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [a!, b!], 'GEAR');
    await joinInOrder(w, [b!], 'CARD');
    expect((await Q.history(a!.h)).json()).toEqual([]);

    const r1 = await openQueueRound(w, admin, [
      { name: 'Helm', category: 'GEAR' as Cat },
      { name: 'Poring Card', category: 'CARD' as Cat },
    ]);
    await Q.setPrefs(a!.h, r1.id, [r1.itemIds[0]!]);
    await Q.setPrefs(b!.h, r1.id, [r1.itemIds[1]!]);
    await A.close(admin.h, r1.id);

    const r2 = await openQueueRound(w, admin, [{ name: 'Armor', category: 'GEAR' as Cat }]);
    await Q.setPrefs(b!.h, r2.id, [r2.itemIds[0]!]);
    await A.close(admin.h, r2.id);

    const h = (await Q.history(a!.h)).json() as Record<string, unknown>[];
    expect(h.map((x) => [x.roundId, x.itemName, x.category, x.memberId])).toEqual([
      [r2.id, 'Armor', 'GEAR', b!.id],
      [r1.id, 'Helm', 'GEAR', a!.id],
      [r1.id, 'Poring Card', 'CARD', b!.id],
    ]);
    expect(h[1]).toMatchObject({ roundName: 'Queue round', queuePos: 1 });
    expect(typeof h[0]!.wonAt).toBe('string');
    expect((await Q.history(a!.h, '?limit=1')).json()).toHaveLength(1);
    expect((await Q.history(a!.h, '?limit=0')).statusCode).toBe(422);
  });

  it('live-claim wins are not queue history', async () => {
    const admin = await session(w, { admin: true });
    const [a] = await sessions(w, 1);
    const created = await A.create(admin.h, {
      type: 'LIVE_CLAIM',
      name: 'Live',
      startDelaySec: 0,
      items: [{ name: 'Gear drop', category: 'GEAR' }],
    });
    const id = created.json().id as number;
    await A.start(admin.h, id);
    const [item] = await w.db.prisma.auctionItem.findMany({ where: { roundId: id } });
    expect((await A.claim(a!.h, id, item!.id)).statusCode).toBe(200);
    await A.close(admin.h, id);
    expect((await Q.history(a!.h)).json()).toEqual([]);
  });
});
