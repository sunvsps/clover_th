import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api, joinInOrder, openQueueRound, queueApi, queueOrder, session, sessions } from './helpers.js';

const w = useWorld();
const A = api(w);
const Q = queueApi(w);

describe('admin edits a queue (add, remove, reorder)', () => {
  it('rewrites the queue in the given order, keeps joinedAt, and audits before/after', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, c, d] = await sessions(w, 4);
    await joinInOrder(w, [a!, b!, c!], 'GEAR');
    const joinedA = (await w.db.prisma.queueEntry.findFirstOrThrow({ where: { memberId: a!.id, category: 'GEAR' } })).joinedAt;

    // move C to the front, drop B, add D at the end
    const res = await Q.replace(admin.h, 'GEAR', [c!.id, a!.id, d!.id], [a!.id, b!.id, c!.id]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ category: 'GEAR', length: 3, entries: [{ rank: 1, memberId: c!.id }, { rank: 2, memberId: a!.id }, { rank: 3, memberId: d!.id }] });
    expect(await queueOrder(w, 'GEAR')).toEqual([c!.id, a!.id, d!.id]);
    expect((await Q.queues(d!.h)).json().find((q: { category: string }) => q.category === 'GEAR').myRank).toBe(3);
    expect((await w.db.prisma.queueEntry.findFirstOrThrow({ where: { memberId: a!.id, category: 'GEAR' } })).joinedAt).toEqual(joinedA);
    // other queues are untouched
    expect(await queueOrder(w, 'CARD')).toEqual([]);

    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'queue.edit' } });
    expect(log).toMatchObject({ actorId: admin.id, entityId: 'GEAR' });
    expect(log.meta).toEqual({ before: [a!.id, b!.id, c!.id], after: [c!.id, a!.id, d!.id] });
  });

  it('refuses a stale edit (QUEUE_CHANGED) so a member who joined meanwhile is not dropped', async () => {
    const admin = await session(w, { admin: true });
    const [a, b, late] = await sessions(w, 3);
    await joinInOrder(w, [a!, b!], 'CARD');
    const loaded = [a!.id, b!.id];
    await Q.join(late!.h, 'CARD');
    const res = await Q.replace(admin.h, 'CARD', [b!.id, a!.id], loaded);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('QUEUE_CHANGED');
    expect(await queueOrder(w, 'CARD')).toEqual([a!.id, b!.id, late!.id]);
  });

  it('is refused while a queue round of that category is open, and allowed for another category', async () => {
    const admin = await session(w, { admin: true });
    const [a, b] = await sessions(w, 2);
    await joinInOrder(w, [a!, b!], 'GEAR');
    await joinInOrder(w, [a!, b!], 'RELIC');
    const r = await openQueueRound(w, admin, [{ name: 'G', category: 'GEAR' }]);
    const res = await Q.replace(admin.h, 'GEAR', [b!.id, a!.id]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'QUEUE_ROUND_OPEN', details: { roundId: r.id } });
    expect((await Q.replace(admin.h, 'RELIC', [b!.id, a!.id])).statusCode).toBe(200);
    await A.close(admin.h, r.id);
    expect((await Q.replace(admin.h, 'GEAR', [b!.id, a!.id], await queueOrder(w, 'GEAR'))).statusCode).toBe(200);
  });

  it('validates: no duplicates, only active members, a queue category, admins only', async () => {
    const admin = await session(w, { admin: true });
    const [a, gone] = await sessions(w, 2);
    await w.db.prisma.member.update({ where: { id: gone!.id }, data: { isActive: false } });
    expect((await Q.replace(admin.h, 'GEAR', [a!.id, a!.id])).json().error.code).toBe('VALIDATION_ERROR');
    const inactive = await Q.replace(admin.h, 'GEAR', [a!.id, gone!.id]);
    expect(inactive.statusCode).toBe(422);
    expect(inactive.json().error).toMatchObject({ code: 'MEMBER_INACTIVE', details: { memberIds: [gone!.id] } });
    expect((await Q.replace(admin.h, 'PET', [a!.id])).json().error.code).toBe('INVALID_QUEUE_CATEGORY');
    expect((await Q.replace(a!.h, 'GEAR', [a!.id])).statusCode).toBe(403);
    expect(await queueOrder(w, 'GEAR')).toEqual([]);
    // an empty list clears the queue
    await Q.join(a!.h, 'GEAR');
    expect((await Q.replace(admin.h, 'GEAR', [])).json().length).toBe(0);
    expect(await queueOrder(w, 'GEAR')).toEqual([]);
  });
});
