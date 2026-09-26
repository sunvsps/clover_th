import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api, openQueueRound, openRound, session } from './helpers.js';

const w = useWorld({ env: { CLAIM_RATE_MAX: '1000' } });
const A = api(w);

describe('leftover draft of a live-claim round', () => {
  it('copies every item into its slot, disables the claimed and already-disabled ones, and is created once', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin, {
      winCap: 3,
      durationSec: 120,
      items: [
        { name: 'Item 1', category: null },
        { name: 'Item 2', category: 'GEAR' },
        { name: 'Item 3', category: null },
        { name: 'Item 4', category: null, disabled: true },
      ],
    });
    expect((await A.claim(a.h, r.id, r.itemIds[0]!)).statusCode).toBe(200);
    expect((await A.close(admin.h, r.id)).statusCode).toBe(200);

    const made = await A.leftover(admin.h, r.id);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ type: 'LIVE_CLAIM', status: 'DRAFT', name: 'Round (leftovers)', winCap: 3, durationSec: 120 });
    const draft = (await A.get(admin.h, made.json().id)).json();
    expect(draft.items.map((i: { name: string; category: string | null; disabled: boolean; winner: unknown }) => [i.name, i.category, i.disabled, i.winner])).toEqual([
      ['Item 1', null, true, null],
      ['Item 2', 'GEAR', false, null],
      ['Item 3', null, false, null],
      ['Item 4', null, true, null],
    ]);
    expect((await A.results(admin.h, r.id)).json().leftoverRoundId).toBe(made.json().id);

    const again = await A.leftover(admin.h, r.id);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(made.json().id);
    expect(await w.db.prisma.auctionRound.count({ where: { sourceRoundId: r.id } })).toBe(1);
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'auction.round.leftover' } });
    expect(log).toMatchObject({ actorId: admin.id, entityId: String(made.json().id) });

    const listed = (await A.list(admin.h)).json().rounds as { id: number; sourceRoundId: number | null; leftoverRoundId: number | null }[];
    expect(listed.find((x) => x.id === r.id)).toMatchObject({ sourceRoundId: null, leftoverRoundId: made.json().id });
    expect(listed.find((x) => x.id === made.json().id)).toMatchObject({ sourceRoundId: r.id, leftoverRoundId: null });
  });

  it('repeats once only: the leftover round, once closed, cannot make another leftover round', async () => {
    const admin = await session(w, { admin: true });
    const r = await openRound(w, admin, { itemCount: 2 });
    await A.close(admin.h, r.id);
    const leftover = (await A.leftover(admin.h, r.id)).json().id as number;
    expect((await A.start(admin.h, leftover)).statusCode).toBe(200);
    await A.close(admin.h, leftover);
    const again = await A.leftover(admin.h, leftover);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'LEFTOVER_NOT_REPEATABLE', details: { sourceRoundId: r.id } });
    expect(await w.db.prisma.auctionRound.count({ where: { sourceRoundId: leftover } })).toBe(0);
  });

  it('is refused for an open round, a queue round, a fully claimed round, and for non-admins', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const open = await openRound(w, admin, { itemCount: 1 });
    const early = await A.leftover(admin.h, open.id);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('ROUND_NOT_CLOSED');

    expect((await A.leftover(a.h, open.id)).statusCode).toBe(403);

    await A.claim(a.h, open.id, open.itemIds[0]!);
    await A.close(admin.h, open.id);
    const none = await A.leftover(admin.h, open.id);
    expect(none.statusCode).toBe(409);
    expect(none.json().error.code).toBe('NO_LEFTOVER_ITEMS');

    const q = await openQueueRound(w, admin, [{ name: 'G', category: 'GEAR' }]);
    await A.close(admin.h, q.id);
    const queue = await A.leftover(admin.h, q.id);
    expect(queue.statusCode).toBe(409);
    expect(queue.json().error.code).toBe('LEFTOVER_LIVE_CLAIM_ONLY');
  });
});
