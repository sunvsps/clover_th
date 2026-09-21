import { describe, expect, it } from 'vitest';
import { createSweeper } from '../../src/modules/auctions/sweeper.js';
import { useWorld } from '../helpers/world.js';
import { api, items, openRound, session, setWindow } from './helpers.js';

const w = useWorld();
const A = api(w);
const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);
const draft = (h: Record<string, string>, extra: object = {}) =>
  A.create(h, { type: 'LIVE_CLAIM', name: 'Guild boss drops', items: items(3), ...extra });

describe('WP8 admin: create, edit, start, close, cancel', () => {
  it('only admins can create, edit, start, close or cancel; nothing changes', async () => {
    const admin = await session(w, { admin: true });
    const me = await session(w);
    const r = (await draft(admin.h)).json();
    for (const res of [
      await A.create(me.h, { type: 'LIVE_CLAIM', name: 'x', items: [] }),
      await A.patch(me.h, r.id, { name: 'hack' }),
      await A.start(me.h, r.id),
      await A.close(me.h, r.id),
      await A.cancel(me.h, r.id),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ADMIN_REQUIRED');
    }
    expect(await w.db.prisma.auctionRound.count()).toBe(1);
    expect((await w.db.prisma.auctionRound.findFirstOrThrow()).status).toBe('DRAFT');
  });

  it('creates a DRAFT with defaults (300 s, cap 5, 3 s delay) and accepts any item category', async () => {
    const admin = await session(w, { admin: true });
    const res = await A.create(admin.h, {
      type: 'LIVE_CLAIM',
      name: 'All categories',
      items: (['PET', 'MATERIAL', 'GEMBOX', 'GEAR', 'CARD', 'RELIC'] as const).map((category) => ({
        name: `i-${category}`,
        category,
        rarity: 'Rare',
        imageUrl: 'https://example.com/a.png',
      })),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'LIVE_CLAIM',
      status: 'DRAFT',
      durationSec: 300,
      winCap: 5,
      startDelaySec: 3,
      opensAt: null,
      closesAt: null,
    });
    expect(await w.db.prisma.auctionItem.count({ where: { roundId: res.json().id } })).toBe(6);
    expect(
      (await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'auction.round.create' } })).actorId,
    ).toBe(admin.id);
  });

  it('validation: unknown category/type/field, bad image URL, NUL, invisible names, bounds', async () => {
    const admin = await session(w, { admin: true });
    const bad = [
      { type: 'LIVE_CLAIM', name: 'x', items: [{ name: 'a', category: 'WEAPON' }] },
      { type: 'BIDDING', name: 'x', items: [] },
      { type: 'LIVE_CLAIM', name: 'x', items: [], isAdmin: true },
      {
        type: 'LIVE_CLAIM',
        name: 'x',
        items: [{ name: 'a', category: 'PET', imageUrl: 'javascript:alert(1)' }],
      },
      { type: 'LIVE_CLAIM', name: `a${NUL}b`, items: [] },
      { type: 'LIVE_CLAIM', name: ZWSP, items: [] },
      { type: 'LIVE_CLAIM', name: 'x', durationSec: 1, items: [] },
      { type: 'LIVE_CLAIM', name: 'x', winCap: 0, items: [] },
    ];
    for (const b of bad) expect((await A.create(admin.h, b)).statusCode, JSON.stringify(b)).toBe(422);
    expect(await w.db.prisma.auctionRound.count()).toBe(0);
  });

  it('a draft can be edited (name, duration, cap, delay, items replaced); a started round cannot', async () => {
    const admin = await session(w, { admin: true });
    const r = (await draft(admin.h)).json();
    const p = await A.patch(admin.h, r.id, {
      name: 'Renamed',
      durationSec: 120,
      winCap: 2,
      items: [{ name: 'Only', category: 'GEAR' }],
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: 'Renamed', durationSec: 120, winCap: 2 });
    expect(await w.db.prisma.auctionItem.count({ where: { roundId: r.id } })).toBe(1);
    expect((await A.patch(admin.h, r.id, {})).statusCode).toBe(422);
    await A.start(admin.h, r.id, { startDelaySec: 0 });
    const late = await A.patch(admin.h, r.id, { name: 'too late' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ROUND_NOT_DRAFT');
  });

  it('start: an empty round gives ROUND_EMPTY; server sets opensAt/closesAt (delay 3 s, duration 300 s by default)', async () => {
    const admin = await session(w, { admin: true });
    const empty = (await A.create(admin.h, { type: 'LIVE_CLAIM', name: 'empty', items: [] })).json();
    const e = await A.start(admin.h, empty.id);
    expect(e.statusCode).toBe(409);
    expect(e.json().error.code).toBe('ROUND_EMPTY');
    const r = (await draft(admin.h)).json();
    const before = Date.now();
    const s = await A.start(admin.h, r.id);
    expect(s.statusCode).toBe(200);
    const b = s.json();
    expect(b.status).toBe('OPEN');
    const opens = new Date(b.opensAt).getTime();
    const closes = new Date(b.closesAt).getTime();
    expect(closes - opens).toBe(300_000);
    expect(opens - before).toBeGreaterThan(2000);
    expect(opens - before).toBeLessThan(5000);
    expect((await A.start(admin.h, r.id)).json().error.code).toBe('ROUND_NOT_DRAFT');
  });

  it('start accepts per-round overrides of delay and duration', async () => {
    const admin = await session(w, { admin: true });
    const r = (await draft(admin.h)).json();
    const s = (await A.start(admin.h, r.id, { startDelaySec: 0, durationSec: 60 })).json();
    expect(new Date(s.closesAt).getTime() - new Date(s.opensAt).getTime()).toBe(60_000);
    expect(s).toMatchObject({ durationSec: 60, startDelaySec: 0 });
  });

  it('one OPEN round per type: a second start gives ANOTHER_ROUND_OPEN; after close it is fine', async () => {
    const admin = await session(w, { admin: true });
    const a = (await draft(admin.h)).json();
    const b = (await draft(admin.h)).json();
    await A.start(admin.h, a.id, { startDelaySec: 0 });
    const s = await A.start(admin.h, b.id);
    expect(s.statusCode).toBe(409);
    expect(s.json().error).toMatchObject({ code: 'ANOTHER_ROUND_OPEN', details: { roundId: a.id } });
    await A.close(admin.h, a.id);
    expect((await A.start(admin.h, b.id)).statusCode).toBe(200);
  });

  it('five drafts started at the same moment: exactly one wins', async () => {
    const admin = await session(w, { admin: true });
    const ds = await Promise.all(Array.from({ length: 5 }, () => draft(admin.h)));
    const rs = await Promise.all(ds.map((d) => A.start(admin.h, d.json().id)));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(
      rs.filter((r) => r.statusCode === 409 && r.json().error.code === 'ANOTHER_ROUND_OPEN'),
    ).toHaveLength(4);
    expect(await w.db.prisma.auctionRound.count({ where: { status: 'OPEN' } })).toBe(1);
  });

  it('a stale OPEN round (window over, not swept yet) does not block the next round and is closed', async () => {
    const admin = await session(w, { admin: true });
    const first = await openRound(w, admin);
    await setWindow(w, first.id, '-10 seconds', '-1 second');
    const next = (await draft(admin.h)).json();
    expect((await A.start(admin.h, next.id)).statusCode).toBe(200);
    expect((await w.db.prisma.auctionRound.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'CLOSED',
    );
  });

  it('early close pulls closesAt to now and is idempotent; closing a draft is ROUND_NOT_OPEN', async () => {
    const admin = await session(w, { admin: true });
    const r = await openRound(w, admin);
    const before = await A.get(admin.h, r.id);
    const c = await A.close(admin.h, r.id);
    expect(c.statusCode).toBe(200);
    expect(c.json().status).toBe('CLOSED');
    expect(new Date(c.json().closesAt).getTime()).toBeLessThan(new Date(before.json().closesAt).getTime());
    expect(new Date(c.json().closesAt).getTime()).toBeLessThanOrEqual(Date.now() + 2000);
    const again = await A.close(admin.h, r.id);
    expect(again.statusCode).toBe(200);
    expect(again.json().closesAt).toBe(c.json().closesAt);
    const d = (await draft(admin.h)).json();
    expect((await A.close(admin.h, d.id)).json().error.code).toBe('ROUND_NOT_OPEN');
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.round.close' } })).toBe(1);
  });

  it('cancel works for a draft and an open round, is idempotent, and refuses a closed round', async () => {
    const admin = await session(w, { admin: true });
    const d = (await draft(admin.h)).json();
    expect((await A.cancel(admin.h, d.id)).json().status).toBe('CANCELLED');
    expect((await A.cancel(admin.h, d.id)).json().status).toBe('CANCELLED');
    const o = await openRound(w, admin);
    expect((await A.cancel(admin.h, o.id)).json().status).toBe('CANCELLED');
    const next = await openRound(w, admin); // the slot is free again
    await A.close(admin.h, next.id);
    expect((await A.cancel(admin.h, next.id)).json().error.code).toBe('ROUND_CLOSED');
  });

  it('lifecycle writes are audited with the admin as actor', async () => {
    const admin = await session(w, { admin: true });
    const r = await openRound(w, admin);
    await A.close(admin.h, r.id);
    const actions = (await w.db.prisma.auditLog.findMany({ where: { actorId: admin.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['auction.round.create', 'auction.round.start', 'auction.round.close']),
    );
  });

  it('lazy finalize: reading an expired OPEN round closes it; the sweeper closes it too', async () => {
    const admin = await session(w, { admin: true });
    const me = await session(w);
    const a = await openRound(w, admin);
    await setWindow(w, a.id, '-10 seconds', '-1 second');
    expect((await A.get(me.h, a.id)).json().status).toBe('CLOSED');
    const b = await openRound(w, admin);
    await setWindow(w, b.id, '-10 seconds', '-1 second');
    const sweeper = createSweeper({ prisma: w.db.prisma, tx: w.app.tx });
    expect(await sweeper.tick()).toBe(1);
    expect(await sweeper.tick()).toBe(0);
    expect((await w.db.prisma.auctionRound.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CLOSED');
  });

  it('drafts are invisible to non-admins (list and GET)', async () => {
    const admin = await session(w, { admin: true });
    const me = await session(w);
    const d = (await draft(admin.h)).json();
    expect((await A.get(me.h, d.id)).statusCode).toBe(404);
    expect((await A.list(me.h)).json().rounds.map((x: { id: number }) => x.id)).not.toContain(d.id);
    expect((await A.list(admin.h)).json().rounds.map((x: { id: number }) => x.id)).toContain(d.id);
    expect((await A.list(me.h, '?status=DRAFT')).json().rounds).toEqual([]);
    expect((await A.get(admin.h, d.id)).statusCode).toBe(200);
  });
});
