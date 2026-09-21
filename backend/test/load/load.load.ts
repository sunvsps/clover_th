// Load and soak tests for the 80-member targets (design WP10). NOT part of `npm test`.
//   npm run test:load                      ~1 minute (soak SOAK_SECONDS defaults to 20)
//   SOAK_SECONDS=300 npm run test:load     the 5 minute soak of the design
// Requests are injected in-process (no TCP), against real Postgres with the production pool settings
// (connection_limit=25), so the numbers show server + database cost, not network latency.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replayAllocation } from '../../src/modules/auctions/replay.js';
import {
  api,
  openQueueRound,
  openRound,
  percentile,
  queueApi,
  session,
  sessions,
  type Cat,
} from '../auctions/helpers.js';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const A = api(w);
const Q = queueApi(w);
const MEMBERS = 80;
const SOAK_SECONDS = Number(process.env.SOAK_SECONDS ?? 20);
const P95_TARGET_MS = 200;

type Res = { statusCode: number };
class Stats {
  lat: number[] = [];
  codes: Record<string, number> = {};
  async run<T extends Res>(fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    const r = await fn();
    this.lat.push(performance.now() - t0);
    this.codes[r.statusCode] = (this.codes[r.statusCode] ?? 0) + 1;
    return r;
  }
  line(name: string) {
    const l = this.lat;
    return `${name.padEnd(34)} n=${String(l.length).padStart(6)}  p50=${percentile(l, 50).toFixed(0).padStart(4)}ms  p95=${percentile(l, 95).toFixed(0).padStart(4)}ms  p99=${percentile(l, 99).toFixed(0).padStart(4)}ms  max=${Math.max(
      ...l,
    )
      .toFixed(0)
      .padStart(4)}ms  codes=${JSON.stringify(this.codes)}`;
  }
}
const report: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

describe('80-member load targets', () => {
  it(`auction night: 80 members poll every 1-2 s while claiming and releasing for ${SOAK_SECONDS} s`, async () => {
    const admin = await session(w, { admin: true });
    const members = await sessions(w, MEMBERS);
    const round = await openRound(w, admin, { itemCount: 60, winCap: 5 });
    const polls = new Stats();
    const claims = new Stats();
    const releases = new Stats();
    const endAt = Date.now() + SOAK_SECONDS * 1000;

    // every member polls with If-None-Match like the frontend would (1-2 s interval)
    const pollers = members.map(async (m) => {
      let etag = '';
      while (Date.now() < endAt) {
        const r = await polls.run(() => A.get(m.h, round.id, etag ? { 'if-none-match': etag } : {}));
        etag = (r.headers.etag as string) ?? etag;
        await sleep(rnd(1000, 2000));
      }
    });

    // the opening burst: all 80 claim at once, then a steady trickle of claims/releases
    const actors = members.map(async (m, i) => {
      await sleep(1500);
      await claims.run(() => A.claim(m.h, round.id, round.itemIds[i % round.itemIds.length]!));
      while (Date.now() < endAt - 1500) {
        await sleep(rnd(1500, 4000));
        const item = round.itemIds[Math.floor(Math.random() * round.itemIds.length)]!;
        if (Math.random() < 0.7) await claims.run(() => A.claim(m.h, round.id, item));
        else await releases.run(() => A.release(m.h, round.id, item));
      }
    });
    await Promise.all([...pollers, ...actors]);

    report.push(polls.line('poll GET round (ETag)'), claims.line('claim'), releases.line('release'));
    const all = [polls, claims, releases];
    for (const s of all) {
      for (const code of Object.keys(s.codes))
        expect(Number(code), `${code} in ${JSON.stringify(s.codes)}`).toBeLessThan(500);
    }
    expect(percentile(polls.lat, 95)).toBeLessThan(P95_TARGET_MS);
    expect(percentile(claims.lat, 95)).toBeLessThan(P95_TARGET_MS);
    // correctness under load: one winner per item, nobody over the cap
    const won = await w.db.prisma.auctionItem.groupBy({
      by: ['winnerId'],
      where: { roundId: round.id, winnerId: { not: null } },
      _count: true,
    });
    expect(won.every((g) => g._count <= 5)).toBe(true);
    expect(
      await w.db.prisma.auctionItem.count({ where: { roundId: round.id, winnerId: { not: null } } }),
    ).toBe(won.reduce((n, g) => n + g._count, 0));
  });

  it('80 concurrent claims on ONE item: exactly one winner (repeated 5 times)', async () => {
    const admin = await session(w, { admin: true });
    const members = await sessions(w, MEMBERS);
    const s = new Stats();
    for (let i = 0; i < 5; i++) {
      const r = await openRound(w, admin, { itemCount: 1 });
      const rs = await Promise.all(members.map((m) => s.run(() => A.claim(m.h, r.id, r.itemIds[0]!))));
      expect(rs.filter((x) => x.statusCode === 200)).toHaveLength(1);
      await A.close(admin.h, r.id);
    }
    report.push(s.line('80 claims on one item x5'));
    expect(percentile(s.lat, 95)).toBeLessThan(P95_TARGET_MS);
    expect(Object.keys(s.codes).every((c) => Number(c) < 500)).toBe(true);
  });

  it('registration burst: 80 members register for one Polarity Zone occurrence at once (capacity 50), then 80 mixed changes and reads', async () => {
    const admin = await session(w, { admin: true });
    const members = await sessions(w, MEMBERS, 'Reg');
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { registrationCapacity: 50 } });
    const date = futureDate(6);
    const put = (h: Record<string, string>, id: string, status: string) =>
      w.app.inject({
        method: 'PUT',
        url: `/api/v1/events/polarity-zone/occurrences/${date}/registrations/${id}`,
        headers: h,
        payload: { status },
      });
    const reg = new Stats();
    const rs = await Promise.all(members.map((m) => reg.run(() => put(m.h, 'me', 'JOINED'))));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const occ = await w.db.prisma.occurrence.findFirstOrThrow({ where: { eventId: 'polarity-zone' } });
    expect(await w.db.prisma.registration.count({ where: { occurrenceId: occ.id, status: 'JOINED' } })).toBe(
      50,
    );
    expect(
      await w.db.prisma.registration.count({ where: { occurrenceId: occ.id, status: 'WAITLISTED' } }),
    ).toBe(30);

    // 40 leave, 40 register again, while everybody reads the range and the plan
    const reads = new Stats();
    const mixed = await Promise.all([
      ...members.slice(0, 40).map((m) => reg.run(() => put(m.h, 'me', 'LEAVE'))),
      ...members.slice(40).map((m) => reg.run(() => put(m.h, 'me', 'NONE'))),
      ...members.map((m) =>
        reads.run(() => w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: m.h })),
      ),
      ...members.map((m) =>
        reads.run(() =>
          w.app.inject({ url: `/api/v1/events/polarity-zone/occurrences/${date}/plan`, headers: m.h }),
        ),
      ),
    ]);
    expect(mixed.every((r) => r.statusCode === 200)).toBe(true);
    const joined = await w.db.prisma.registration.count({
      where: { occurrenceId: occ.id, status: 'JOINED' },
    });
    expect(joined).toBeLessThanOrEqual(50);
    const waiting = await w.db.prisma.registration.count({
      where: { occurrenceId: occ.id, status: 'WAITLISTED' },
    });
    expect(waiting === 0 || joined === 50).toBe(true); // a waitlist exists only while the seats are full
    void admin;
    report.push(reg.line('registration PUT (burst + mixed)'), reads.line('registrations + plan reads'));
    expect(percentile(reg.lat, 95)).toBeLessThan(P95_TARGET_MS * 5); // 80 writes serialize on one Activity lock by design
    expect(
      Object.keys(reg.codes)
        .concat(Object.keys(reads.codes))
        .every((c) => Number(c) < 500),
    ).toBe(true);
  });

  it('type 2 at full size: 80 members join 3 queues, submit lists, the round closes and allocates (replay matches)', async () => {
    const admin = await session(w, { admin: true });
    const members = await sessions(w, MEMBERS, 'Q');
    const cats = ['GEAR', 'CARD', 'RELIC'] as const;
    const join = new Stats();
    await Promise.all(members.flatMap((m) => cats.map((c) => join.run(() => Q.join(m.h, c)))));
    const items = cats.flatMap((c) =>
      Array.from({ length: 20 }, (_, i) => ({ name: `${c} ${i + 1}`, category: c as Cat })),
    );
    const round = await openQueueRound(w, admin, items);
    const submit = new Stats();
    await Promise.all(
      members.map((m) => {
        const shuffled = [...round.itemIds].sort(() => Math.random() - 0.5).slice(0, 25);
        return submit.run(() => Q.setPrefs(m.h, round.id, shuffled));
      }),
    );
    const t0 = performance.now();
    const closed = await A.close(admin.h, round.id);
    const closeMs = performance.now() - t0;
    expect(closed.statusCode).toBe(200);
    const won = await w.db.prisma.auctionItem.count({
      where: { roundId: round.id, winnerId: { not: null } },
    });
    expect(won).toBeGreaterThan(0);
    expect((await replayAllocation(w.db.prisma, round.id)).matches).toBe(true);
    for (const c of cats)
      expect(await w.db.prisma.queueEntry.count({ where: { category: c } })).toBe(MEMBERS);
    report.push(
      join.line('queue join (80 x 3 categories)'),
      submit.line('preferences submit (25 items)'),
      `allocation on close (80 members, 60 items, 3 categories): ${closeMs.toFixed(0)}ms, ${won} awards`,
    );
    expect(percentile(submit.lat, 95)).toBeLessThan(P95_TARGET_MS * 5);
    expect(closeMs).toBeLessThan(5000);
  });

  it('summary', () => {
    const text = `LOAD TEST RESULTS (80 members, soak ${SOAK_SECONDS}s, in-process against Postgres, pool connection_limit=25)\n${report.join('\n')}\n`;
    process.stdout.write(`\n${text}`);
    writeFileSync(process.env.LOAD_REPORT ?? 'test/load/last-run.txt', text);
    expect(report.length).toBeGreaterThan(0);
  });
});
