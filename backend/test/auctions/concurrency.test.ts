import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api, openRound, percentile, session, sessions } from './helpers.js';

// claim rate limit raised so the cap and the race (not the limiter) are what is tested
const w = useWorld({ env: { CLAIM_RATE_MAX: '1000' } });
const A = api(w);
const codes = (rs: { statusCode: number; json: () => { error?: { code: string } } }[]) =>
  rs.map((r) => (r.statusCode === 200 ? 'OK' : (r.json().error?.code ?? String(r.statusCode))));
const tally = (xs: string[]) =>
  xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

describe('WP8 concurrency (Promise.all against real Postgres, production pool settings)', () => {
  it('80 parallel claims on ONE item by 80 members: exactly one winner, 79 ITEM_ALREADY_CLAIMED, no 503/P2028; latency measured', async () => {
    const admin = await session(w, { admin: true });
    const bidders = await sessions(w, 80);
    const r = await openRound(w, admin, { itemCount: 1 });
    const times: number[] = [];
    const rs = await Promise.all(
      bidders.map(async (b) => {
        const t0 = performance.now();
        const res = await A.claim(b.h, r.id, r.itemIds[0]!);
        times.push(performance.now() - t0);
        return res;
      }),
    );
    expect(tally(codes(rs))).toEqual({ OK: 1, ITEM_ALREADY_CLAIMED: 79 });
    expect(rs.some((x) => x.statusCode === 503)).toBe(false);
    const winners = await w.db.prisma.auctionItem.findMany({
      where: { roundId: r.id, winnerId: { not: null } },
    });
    expect(winners).toHaveLength(1);
    const winnerId = winners[0]!.winnerId;
    expect(rs.find((x) => x.statusCode === 200)!.json().item.winner.memberId).toBe(winnerId);
    // every loser is told the SAME winner
    for (const x of rs.filter((y) => y.statusCode === 409))
      expect(x.json().error.details.winner.memberId).toBe(winnerId);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.claim' } })).toBe(1);
    const line = `80 parallel claims on one item: p50=${percentile(times, 50).toFixed(0)}ms p95=${percentile(times, 95).toFixed(0)}ms max=${Math.max(...times).toFixed(0)}ms (pool connection_limit=25, injected in-process, no network)\n`;
    if (process.env.LOAD_REPORT) appendFileSync(process.env.LOAD_REPORT, line);
    expect(percentile(times, 95)).toBeLessThan(1000);
  });

  it('80 members claiming 80 DIFFERENT items at once all win, none fails (pool limit 25 does not cause SERVICE_BUSY)', async () => {
    const admin = await session(w, { admin: true });
    const bidders = await sessions(w, 80);
    const r = await openRound(w, admin, { itemCount: 80 });
    const times: number[] = [];
    const rs = await Promise.all(
      bidders.map(async (b, i) => {
        const t0 = performance.now();
        const res = await A.claim(b.h, r.id, r.itemIds[i]!);
        times.push(performance.now() - t0);
        return res;
      }),
    );
    expect(tally(codes(rs))).toEqual({ OK: 80 });
    expect(await w.db.prisma.auctionItem.count({ where: { roundId: r.id, winnerId: { not: null } } })).toBe(
      80,
    );
    const line = `80 parallel claims on 80 items: p50=${percentile(times, 50).toFixed(0)}ms p95=${percentile(times, 95).toFixed(0)}ms max=${Math.max(...times).toFixed(0)}ms\n`;
    if (process.env.LOAD_REPORT) appendFileSync(process.env.LOAD_REPORT, line);
  });

  it('one member claiming 10 different items in parallel ends with exactly 5 (CLAIM_CAP_REACHED for the rest); repeated', async () => {
    const admin = await session(w, { admin: true });
    for (let round = 0; round < 6; round++) {
      const me = await session(w);
      const r = await openRound(w, admin, { itemCount: 10 });
      const rs = await Promise.all(r.itemIds.map((id) => A.claim(me.h, r.id, id)));
      expect(tally(codes(rs))).toEqual({ OK: 5, CLAIM_CAP_REACHED: 5 });
      expect(await w.db.prisma.auctionItem.count({ where: { roundId: r.id, winnerId: me.id } })).toBe(5);
      await A.close(admin.h, r.id);
    }
  });

  it('the cap holds when many members each fire 10 parallel claims at 10 shared items', async () => {
    const admin = await session(w, { admin: true });
    const bidders = await sessions(w, 12);
    const r = await openRound(w, admin, { itemCount: 10 });
    const rs = await Promise.all(bidders.flatMap((b) => r.itemIds.map((id) => A.claim(b.h, r.id, id))));
    expect(rs.some((x) => x.statusCode >= 500)).toBe(false);
    const won = await w.db.prisma.auctionItem.findMany({ where: { roundId: r.id, winnerId: { not: null } } });
    expect(won).toHaveLength(10); // every item has exactly one winner
    const perMember = await w.db.prisma.auctionItem.groupBy({
      by: ['winnerId'],
      where: { roundId: r.id, winnerId: { not: null } },
      _count: true,
    });
    expect(perMember.every((g) => g._count <= 5)).toBe(true);
  });

  it('the same member claiming the same item 10 times at once: all 200, one winner row, one audit row', async () => {
    const admin = await session(w, { admin: true });
    const me = await session(w);
    const r = await openRound(w, admin, { itemCount: 2 });
    const rs = await Promise.all(Array.from({ length: 10 }, () => A.claim(me.h, r.id, r.itemIds[0]!)));
    expect(tally(codes(rs))).toEqual({ OK: 10 });
    expect(await w.db.prisma.auditLog.count({ where: { action: 'auction.claim' } })).toBe(1);
    expect((await A.get(me.h, r.id)).json().myWinCount).toBe(1);
  });

  it('claims racing an admin early close: each is either committed before close returned, or rejected ROUND_CLOSED; nothing wins after', async () => {
    const admin = await session(w, { admin: true });
    const bidders = await sessions(w, 20);
    for (let round = 0; round < 8; round++) {
      const r = await openRound(w, admin, { itemCount: 20 });
      const [close, ...claims] = await Promise.all([
        A.close(admin.h, r.id),
        ...bidders.map((b, i) => A.claim(b.h, r.id, r.itemIds[i]!)),
      ]);
      expect(close.statusCode).toBe(200);
      for (const c of claims) expect([200, 409]).toContain(c.statusCode);
      for (const c of claims.filter((x) => x.statusCode === 409))
        expect(c.json().error.code).toBe('ROUND_CLOSED');
      const [row] = await w.db.prisma.$queryRaw<{ late: number; total: number }[]>`
        SELECT count(*) FILTER (WHERE i."wonAt" > r."closesAt")::int AS late,
               count(i."winnerId")::int AS total
        FROM "AuctionItem" i JOIN "AuctionRound" r ON r.id = i."roundId" WHERE r.id = ${r.id}`;
      expect(row!.late).toBe(0); // no claim committed after the close's closesAt
      expect(row!.total).toBe(claims.filter((x) => x.statusCode === 200).length); // every 200 is a real win and vice versa
      // and once close returned, a fresh claim is refused
      expect((await A.claim(bidders[0]!.h, r.id, r.itemIds[19]!)).statusCode).toBe(409);
    }
  });

  it('a release racing another member claim on the same item leaves a consistent winner', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    for (let round = 0; round < 15; round++) {
      const r = await openRound(w, admin, { itemCount: 1 });
      await A.claim(a.h, r.id, r.itemIds[0]!);
      const [rel, claim] = await Promise.all([
        A.release(a.h, r.id, r.itemIds[0]!),
        A.claim(b.h, r.id, r.itemIds[0]!),
      ]);
      expect(rel.statusCode).toBe(200);
      const item = await w.db.prisma.auctionItem.findUniqueOrThrow({ where: { id: r.itemIds[0]! } });
      if (claim.statusCode === 200) {
        expect(item.winnerId).toBe(b.id); // release happened first, B took the freed item
      } else {
        expect(claim.json().error.code).toBe('ITEM_ALREADY_CLAIMED'); // B lost the race to A's still-held claim
        expect(item.winnerId).toBeNull(); // then A's release freed it
      }
      expect(item.winnerId === null || item.wonAt !== null).toBe(true);
      await A.close(admin.h, r.id);
    }
  });

  it('a release racing the same member claiming another item cannot break the cap', async () => {
    const admin = await session(w, { admin: true });
    for (let round = 0; round < 6; round++) {
      const me = await session(w);
      const r = await openRound(w, admin, { itemCount: 8 });
      for (const id of r.itemIds.slice(0, 5)) await A.claim(me.h, r.id, id);
      const rs = await Promise.all([
        A.release(me.h, r.id, r.itemIds[0]!),
        ...r.itemIds.slice(5).map((id) => A.claim(me.h, r.id, id)),
      ]);
      expect(rs.some((x) => x.statusCode >= 500)).toBe(false);
      expect(
        await w.db.prisma.auctionItem.count({ where: { roundId: r.id, winnerId: me.id } }),
      ).toBeLessThanOrEqual(5);
      await A.close(admin.h, r.id);
    }
  });

  it('the sweeper closing an expired round while claims arrive: late claims are rejected by their own window check', async () => {
    const admin = await session(w, { admin: true });
    const bidders = await sessions(w, 10);
    const r = await openRound(w, admin, { itemCount: 10 });
    await w.db.prisma
      .$executeRaw`UPDATE "AuctionRound" SET "closesAt" = clock_timestamp() - interval '1 second' WHERE id = ${r.id}`;
    const rs = await Promise.all(bidders.map((b, i) => A.claim(b.h, r.id, r.itemIds[i]!)));
    expect(tally(codes(rs))).toEqual({ ROUND_CLOSED: 10 });
    expect(await w.db.prisma.auctionItem.count({ where: { roundId: r.id, winnerId: { not: null } } })).toBe(
      0,
    );
  });
});
