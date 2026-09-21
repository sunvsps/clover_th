import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api, items, openRound, session, setWindow } from './helpers.js';

const w = useWorld({ env: { CLAIM_RATE_MAX: '1000' } });
const A = api(w);

describe('WP8 claim and release (AC-3)', () => {
  it('a claim wins the item, the winner is visible immediately via GET, with myWinCount and an audit row', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin);
    const c = await A.claim(a.h, r.id, r.itemIds[0]!);
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ myWinCount: 1, item: { id: r.itemIds[0], winner: { memberId: a.id } } });
    expect(new Date(c.json().item.winner.wonAt).toISOString()).toBe(c.json().item.winner.wonAt);
    const seen = (await A.get(b.h, r.id)).json();
    expect(seen.items[0].winner.memberId).toBe(a.id);
    expect(seen.items[1].winner).toBeNull();
    expect(seen.myWinCount).toBe(0);
    expect((await A.get(a.h, r.id)).json().myWinCount).toBe(1);
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'auction.claim' } });
    expect(log).toMatchObject({ actorId: a.id, entityId: String(r.itemIds[0]) });
    expect(log.meta).toMatchObject({ roundId: r.id });
  });

  it('a second claim on a taken item gives ITEM_ALREADY_CLAIMED naming the winner; the winner is unchanged', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin);
    await A.claim(a.h, r.id, r.itemIds[0]!);
    const late = await A.claim(b.h, r.id, r.itemIds[0]!);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatchObject({
      code: 'ITEM_ALREADY_CLAIMED',
      details: { winner: { memberId: a.id } },
    });
    expect((await w.db.prisma.auctionItem.findUniqueOrThrow({ where: { id: r.itemIds[0]! } })).winnerId).toBe(
      a.id,
    );
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.claim' } })).toBe(1);
  });

  it('retrying your own winning claim returns 200 with the item, also at 5/5, and writes no second audit row', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin, { itemCount: 7 });
    for (const id of r.itemIds.slice(0, 5)) expect((await A.claim(a.h, r.id, id)).statusCode).toBe(200);
    const retry = await A.claim(a.h, r.id, r.itemIds[2]!); // at 5/5, an item the caller owns
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ myWinCount: 5, item: { id: r.itemIds[2] } });
    const sixth = await A.claim(a.h, r.id, r.itemIds[5]!);
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().error).toMatchObject({ code: 'CLAIM_CAP_REACHED', details: { winCap: 5 } });
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.claim' } })).toBe(5);
  });

  it('the cap is per member per round and per-round configurable', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin, { itemCount: 6, winCap: 2 });
    await A.claim(a.h, r.id, r.itemIds[0]!);
    await A.claim(a.h, r.id, r.itemIds[1]!);
    expect((await A.claim(a.h, r.id, r.itemIds[2]!)).json().error.code).toBe('CLAIM_CAP_REACHED');
    expect((await A.claim(b.h, r.id, r.itemIds[2]!)).statusCode).toBe(200);
  });

  it('release frees a cap slot and reopens the item for others; audited; releasing a free item is a no-op', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin, { itemCount: 6 });
    for (const id of r.itemIds.slice(0, 5)) await A.claim(a.h, r.id, id);
    expect((await A.claim(a.h, r.id, r.itemIds[5]!)).json().error.code).toBe('CLAIM_CAP_REACHED');
    const rel = await A.release(a.h, r.id, r.itemIds[0]!);
    expect(rel.statusCode).toBe(200);
    expect(rel.json()).toMatchObject({ myWinCount: 4, item: { winner: null } });
    expect((await A.claim(a.h, r.id, r.itemIds[5]!)).statusCode).toBe(200); // the freed slot
    expect((await A.claim(b.h, r.id, r.itemIds[0]!)).statusCode).toBe(200); // the item is open again
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'auction.release' } });
    expect(log).toMatchObject({ actorId: a.id, entityId: String(r.itemIds[0]) });
    expect((await A.release(a.h, r.id, r.itemIds[1]!)).statusCode).toBe(200);
    expect((await A.release(a.h, r.id, r.itemIds[1]!)).statusCode).toBe(200); // already free
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.release' } })).toBe(2);
  });

  it("releasing someone else's claim is NOT_YOUR_CLAIM 403 and changes nothing", async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin);
    await A.claim(a.h, r.id, r.itemIds[0]!);
    const res = await A.release(b.h, r.id, r.itemIds[0]!);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_CLAIM');
    expect((await w.db.prisma.auctionItem.findUniqueOrThrow({ where: { id: r.itemIds[0]! } })).winnerId).toBe(
      a.id,
    );
  });

  it('claims outside the window are rejected: before opensAt, after closesAt (status still OPEN), draft, closed, cancelled', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin);
    await setWindow(w, r.id, '30 seconds', '330 seconds');
    const early = await A.claim(a.h, r.id, r.itemIds[0]!);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('ROUND_NOT_OPEN');
    await setWindow(w, r.id, '-10 seconds', '-1 second');
    const late = await A.claim(a.h, r.id, r.itemIds[0]!);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ROUND_CLOSED');
    expect((await A.release(a.h, r.id, r.itemIds[0]!)).json().error.code).toBe('ROUND_CLOSED');
    const draft = (await A.create(admin.h, { type: 'LIVE_CLAIM', name: 'd', items: items(1) })).json();
    const draftItem = (await w.db.prisma.auctionItem.findFirstOrThrow({ where: { roundId: draft.id } })).id;
    expect((await A.claim(a.h, draft.id, draftItem)).json().error.code).toBe('ROUND_NOT_OPEN');
    await A.cancel(admin.h, r.id);
    expect((await A.claim(a.h, r.id, r.itemIds[0]!)).json().error.code).toBe('ROUND_CLOSED');
    expect(await w.db.prisma.auctionItem.count({ where: { winnerId: { not: null } } })).toBe(0);
  });

  it('claims after an early close are rejected with ROUND_CLOSED', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin);
    await A.close(admin.h, r.id);
    expect((await A.claim(a.h, r.id, r.itemIds[0]!)).json().error.code).toBe('ROUND_CLOSED');
  });

  it('a deactivated member cannot claim (session is dead immediately)', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin);
    await w.db.prisma.member.update({ where: { id: a.id }, data: { isActive: false } });
    const res = await A.claim(a.h, r.id, r.itemIds[0]!);
    expect(res.statusCode).toBe(401);
    expect(await w.db.prisma.auctionItem.count({ where: { winnerId: { not: null } } })).toBe(0);
  });

  it('unknown round or an item of another round is 404; an unauthenticated call is 401', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r1 = await openRound(w, admin);
    await A.close(admin.h, r1.id);
    const r2 = await openRound(w, admin);
    expect((await A.claim(a.h, r2.id, r1.itemIds[0]!)).statusCode).toBe(404);
    expect((await A.claim(a.h, 999999, 1)).statusCode).toBe(404);
    expect(
      (
        await w.app.inject({
          method: 'POST',
          url: `/api/v1/auctions/rounds/${r2.id}/items/${r2.itemIds[0]}/claim`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it('a type-1 round accepts claims on any category', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const cats = ['PET', 'MATERIAL', 'GEMBOX', 'GEAR', 'CARD', 'RELIC'] as const;
    const r = await openRound(w, admin, {
      items: cats.map((category) => ({ name: category, category })),
      winCap: 6,
    });
    for (const id of r.itemIds) expect((await A.claim(a.h, r.id, id)).statusCode).toBe(200);
  });
});

describe('WP8 polling, results', () => {
  it('GET round carries server time, an ETag, and If-None-Match returns 304; the ETag changes with claims, releases and per member', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin);
    const g1 = await A.get(a.h, r.id);
    expect(g1.statusCode).toBe(200);
    const etag = g1.headers.etag as string;
    expect(etag).toBeTruthy();
    expect(g1.headers['x-server-time']).toBeTruthy();
    expect(Math.abs(new Date(g1.json().serverTime).getTime() - Date.now())).toBeLessThan(5000);
    expect(g1.json()).toMatchObject({
      id: r.id,
      type: 'LIVE_CLAIM',
      status: 'OPEN',
      winCap: 5,
      myWinCount: 0,
    });
    const same = await A.get(a.h, r.id, { 'if-none-match': etag });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    expect(same.headers['x-server-time']).toBeTruthy();
    // per member: another member's ETag differs, so a 304 can never leak someone else's myWinCount
    expect((await A.get(b.h, r.id)).headers.etag).not.toBe(etag);
    // a claim by someone else changes the ETag
    await A.claim(b.h, r.id, r.itemIds[0]!);
    const changed = await A.get(a.h, r.id, { 'if-none-match': etag });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
    const e2 = changed.headers.etag as string;
    expect((await A.get(a.h, r.id, { 'if-none-match': e2 })).statusCode).toBe(304);
    await A.release(b.h, r.id, r.itemIds[0]!);
    expect((await A.get(a.h, r.id, { 'if-none-match': e2 })).statusCode).toBe(200);
  });

  it('list shows summaries with server time', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin);
    const l = (await A.list(a.h, '?status=OPEN')).json();
    expect(l.rounds).toEqual([expect.objectContaining({ id: r.id, status: 'OPEN', itemCount: 3 })]);
    expect(l.serverTime).toBeTruthy();
  });

  it('results are refused before close (ROUND_NOT_CLOSED) and list every winner with wonAt after close', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin);
    await A.claim(a.h, r.id, r.itemIds[0]!);
    await A.claim(b.h, r.id, r.itemIds[1]!);
    const early = await A.results(a.h, r.id);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('ROUND_NOT_CLOSED');
    await A.close(admin.h, r.id);
    const res = (await A.results(a.h, r.id)).json();
    expect(res).toMatchObject({ roundId: r.id, status: 'CLOSED', leftoverRoundId: null });
    expect(res.closedAt).toBeTruthy();
    expect(res.items.map((i: { winner: { memberId: string } | null }) => i.winner?.memberId ?? null)).toEqual(
      [a.id, b.id, null],
    );
    expect(res.items[0].winner.wonAt).toBeTruthy();
  });

  it('results/me returns exactly the caller wins, during and after the round', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin, { itemCount: 5 });
    await A.claim(a.h, r.id, r.itemIds[0]!);
    await A.claim(a.h, r.id, r.itemIds[3]!);
    await A.claim(b.h, r.id, r.itemIds[1]!);
    const mine = (await A.mine(a.h, r.id)).json();
    expect(mine).toMatchObject({ roundId: r.id, status: 'OPEN', myWinCount: 2 });
    expect(mine.items.map((i: { id: number }) => i.id)).toEqual([r.itemIds[0], r.itemIds[3]]);
    await A.close(admin.h, r.id);
    const after = (await A.mine(b.h, r.id)).json();
    expect(after.status).toBe('CLOSED');
    expect(after.items.map((i: { id: number }) => i.id)).toEqual([r.itemIds[1]]);
    expect((await A.mine((await session(w)).h, r.id)).json().items).toEqual([]);
  });

  it('an expired round is finalized on read and its results become available', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const r = await openRound(w, admin);
    await A.claim(a.h, r.id, r.itemIds[0]!);
    await setWindow(w, r.id, '-10 seconds', '-1 second');
    const res = await A.results(a.h, r.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].winner.memberId).toBe(a.id);
  });
});
