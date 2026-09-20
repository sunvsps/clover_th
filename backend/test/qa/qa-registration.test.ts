/* eslint-disable */
// @ts-nocheck
// QA (Sentinel) probes: registration state machine, capacity/waitlist under real concurrency, timezone edges.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF } from '../helpers/app.js';
import { addDays, bangkokToday, dayOfWeekOf } from '../../src/lib/time.js';
import { futureDate, pastDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const EV = 'guild-league-tue-1';
const DOW = 1;
type H = Record<string, string>;
const put = (h: H, date: string, who: string, status: string, event = EV) =>
  w.app.inject({
    method: 'PUT',
    url: `/api/v1/events/${event}/occurrences/${date}/registrations/${who}`,
    headers: h,
    payload: { status },
  });
const occ = (event = EV, date = futureDate(DOW)) =>
  w.db.prisma.occurrence.findFirstOrThrow({ where: { eventId: event, date: new Date(date) } });
const rows = async (occurrenceId: number) =>
  w.db.prisma.registration.findMany({
    where: { occurrenceId },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
  });
const setCap = (id: string, registrationCapacity: number | null) =>
  w.db.prisma.activity.update({ where: { id }, data: { registrationCapacity } });
// Sessions are created directly (the OAuth callback is rate limited to 30/min/IP, which a 60-member stress test would trip).
let tok = 0;
const signIns = (n: number, p = 'S') =>
  Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const m = await w.member(`${p}${i}`);
      const token = `qa-token-${++tok}-${Math.random().toString(36).slice(2)}`;
      await w.db.prisma
        .$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt") VALUES (${createHash('sha256').update(token).digest('hex')}, ${m.id}::uuid, now() + interval '1 day')`;
      const cookie = `session=${token}`;
      return { ...m, cookie, h: { cookie, ...CSRF } };
    }),
  );

describe('QA state machine (sequential)', () => {
  it('all transitions from every state, with registeredAt semantics and response envelope', async () => {
    await setCap('guild-league', 1);
    const [a, b] = await signIns(2);
    const date = futureDate(DOW);
    const st = async (h: H, s: string) => (await put(h, date, 'me', s)).json();
    const reg = async (id: string) => w.db.prisma.registration.findFirst({ where: { memberId: id } });
    // a: NONE -> JOINED ; b: NONE -> WAITLISTED (cap 1)
    expect((await st(a.h, 'JOINED')).status).toBe('JOINED');
    const bw = await st(b.h, 'JOINED');
    expect(bw).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1, promoted: [], backfilled: [] });
    const bT0 = (await reg(b.id))!.registeredAt;
    // WAITLISTED -> JOINED is a no-op
    expect((await st(b.h, 'JOINED')).status).toBe('WAITLISTED');
    expect((await reg(b.id))!.registeredAt).toEqual(bT0);
    // WAITLISTED -> LEAVE frees nothing; a stays JOINED
    expect((await st(b.h, 'LEAVE')).status).toBe('LEAVE');
    expect((await reg(a.id))!.status).toBe('JOINED');
    // LEAVE -> LEAVE no-op
    const bL = (await reg(b.id))!;
    await st(b.h, 'LEAVE');
    expect(await reg(b.id)).toMatchObject({ id: bL.id, registeredAt: bL.registeredAt, status: 'LEAVE' });
    // LEAVE -> JOINED with full capacity => WAITLISTED with a NEW registeredAt (reset)
    expect((await st(b.h, 'JOINED')).status).toBe('WAITLISTED');
    expect((await reg(b.id))!.registeredAt.getTime()).toBeGreaterThan(bT0.getTime());
    // JOINED -> LEAVE promotes b exactly once
    const out = await st(a.h, 'LEAVE');
    expect(out.status).toBe('LEAVE');
    expect(out.promoted).toEqual([b.id]);
    expect((await reg(b.id))!.status).toBe('JOINED');
    // repeating the withdrawal does not promote anyone else / anything again
    const rep = await st(a.h, 'LEAVE');
    expect(rep.promoted).toEqual([]);
    // LEAVE -> NONE deletes; NONE -> NONE no-op
    expect((await st(a.h, 'NONE')).status).toBe('NONE');
    expect(await reg(a.id)).toBeNull();
    expect((await st(a.h, 'NONE')).status).toBe('NONE');
    // JOINED -> NONE (b) with empty waitlist: no error, no promotion
    const bn = await st(b.h, 'NONE');
    expect(bn).toMatchObject({ status: 'NONE', promoted: [] });
    expect(await w.db.prisma.registration.count()).toBe(0);
  });

  it('leave -> joined resets registeredAt so the member goes to the back of the waitlist and of the promotion order', async () => {
    await setCap('guild-league', 1);
    const [a, ...ws] = await signIns(4);
    const date = futureDate(DOW);
    await put(a.h, date, 'me', 'JOINED');
    for (const m of ws) await put(m.h, date, 'me', 'JOINED'); // ws0, ws1, ws2 waitlisted in that order
    await put(ws[0]!.h, date, 'me', 'LEAVE');
    await put(ws[0]!.h, date, 'me', 'JOINED'); // back of the queue now
    const order = (await rows((await occ()).id))
      .filter((r) => r.status === 'WAITLISTED')
      .map((r) => r.memberId);
    expect(order).toEqual([ws[1]!.id, ws[2]!.id, ws[0]!.id]);
    const r1 = await put(a.h, date, 'me', 'NONE');
    expect(r1.json().promoted).toEqual([ws[1]!.id]);
  });

  it('after-start: a member cannot change own status to any value; an admin can change anyone; the boundary flips exactly at startsAt', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await signIns(1);
    const past = pastDate(DOW);
    for (const s of ['JOINED', 'LEAVE', 'NONE']) {
      const r = await put(m.h, past, 'me', s);
      expect(r.statusCode, s).toBe(409);
      expect(r.json().error.code).toBe('REGISTRATION_CLOSED');
    }
    expect((await put(admin.h, past, m.id, 'JOINED')).statusCode).toBe(200);
    // member cannot undo it either
    expect((await put(m.h, past, 'me', 'NONE')).statusCode).toBe(409);
    expect((await put(admin.h, past, m.id, 'NONE')).statusCode).toBe(200);
    // boundary: occurrence starting in ~1.5 s
    const date = futureDate(DOW);
    await w.db.prisma.occurrence.create({
      data: { eventId: EV, date: new Date(date), startsAt: new Date(Date.now() + 1500) },
    });
    expect((await put(m.h, date, 'me', 'JOINED')).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1700));
    const late = await put(m.h, date, 'me', 'LEAVE');
    expect(late.statusCode).toBe(409);
    expect((await put(admin.h, date, m.id, 'LEAVE')).statusCode).toBe(200);
  });

  it('capacity: null default = no waitlist for all 14 activities; raising promotes in registeredAt order; lowering below joined never demotes and blocks promotion until below cap; null removes the cap', async () => {
    const acts = await w.db.prisma.activity.findMany();
    expect(acts).toHaveLength(14);
    expect(acts.every((a) => a.registrationCapacity === null)).toBe(true);
    const ms = await signIns(8);
    const date = futureDate(DOW);
    for (const m of ms.slice(0, 5))
      expect((await put(m.h, date, 'me', 'JOINED')).json().status).toBe('JOINED'); // no cap
    const admin = await w.signIn({ admin: true });
    const patch = (cap: number | null) =>
      w.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/activities/guild-league',
        headers: admin.h,
        payload: { registrationCapacity: cap },
      });
    expect((await patch(2)).statusCode).toBe(200); // lower below joined (5)
    const o = await occ();
    expect((await rows(o.id)).filter((r) => r.status === 'JOINED')).toHaveLength(5); // no demotion
    expect((await put(ms[5]!.h, date, 'me', 'JOINED')).json().status).toBe('WAITLISTED');
    expect((await put(ms[6]!.h, date, 'me', 'JOINED')).json().status).toBe('WAITLISTED');
    // a joined member leaves: joined 4 >= cap 2 -> nobody promoted
    expect((await put(ms[0]!.h, date, 'me', 'LEAVE')).json().promoted).toEqual([]);
    // raise to 6: joined 4 -> 2 free slots -> both waitlisted promoted in order
    const raised = await patch(6);
    expect(raised.json().promoted.map((p: { memberId: string }) => p.memberId)).toEqual([
      ms[5]!.id,
      ms[6]!.id,
    ]);
    // cap back to 5 (full: 6 joined) then a new registrant waits; removing the cap promotes it
    await patch(5);
    expect((await put(ms[7]!.h, date, 'me', 'JOINED')).json().status).toBe('WAITLISTED');
    const cleared = await patch(null);
    expect(cleared.json().promoted.map((p: { memberId: string }) => p.memberId)).toEqual([ms[7]!.id]);
    expect(await w.db.prisma.registration.count({ where: { status: 'WAITLISTED' } })).toBe(0);
  });

  it('capacity is per occurrence: waitlist on one Tuesday does not affect another occurrence or activity', async () => {
    await setCap('guild-league', 1);
    const [a, b] = await signIns(2);
    const d1 = futureDate(DOW);
    const d2 = futureDate(DOW, 2);
    await put(a.h, d1, 'me', 'JOINED');
    expect((await put(b.h, d1, 'me', 'JOINED')).json().status).toBe('WAITLISTED');
    expect((await put(b.h, d2, 'me', 'JOINED')).json().status).toBe('JOINED');
    expect((await put(b.h, futureDate(1), 'me', 'JOINED', 'guild-league-tue-2')).json().status).toBe(
      'JOINED',
    ); // separate event = separate roster
    expect((await put(b.h, futureDate(1), 'me', 'JOINED', 'family-party')).json().status).toBe('JOINED');
  });

  it('non-existent occurrences: failed writes (wrong weekday, forbidden, closed, inactive) leave no Occurrence row behind; GETs never create', async () => {
    const [m, other] = await signIns(2);
    await w.db.prisma.member.update({ where: { id: other.id }, data: { isActive: false } });
    const before = await w.db.prisma.occurrence.count();
    const good = futureDate(DOW);
    await put(m.h, addDays(good, 1), 'me', 'JOINED'); // wrong weekday
    await put(m.h, good, other.id, 'JOINED'); // forbidden
    const admin = await w.signIn({ admin: true });
    await put(admin.h, good, other.id, 'JOINED'); // inactive
    await put(m.h, pastDate(DOW), 'me', 'JOINED'); // closed
    await put(m.h, '2026-02-30', 'me', 'JOINED');
    expect(await w.db.prisma.occurrence.count()).toBe(before);
    for (const url of [
      `/api/v1/registrations?from=${good}&to=${addDays(good, 6)}`,
      '/api/v1/activities',
      '/api/v1/events',
      '/api/v1/members',
      '/api/v1/me',
    ])
      await w.app.inject({ url, headers: m.h });
    expect(await w.db.prisma.occurrence.count()).toBe(before);
  });
});

describe('QA concurrency stress (real Postgres)', () => {
  it('60 members register concurrently with capacity 20: exactly 20 JOINED, 40 WAITLISTED, distinct positions 1..40, no 5xx', async () => {
    await setCap('guild-league', 20);
    const ms = await signIns(60);
    const date = futureDate(DOW);
    const res = await Promise.all(ms.map((m) => put(m.h, date, 'me', 'JOINED')));
    for (const r of res) expect(r.statusCode, r.body).toBe(200);
    const o = await occ();
    const all = await rows(o.id);
    expect(all.filter((r) => r.status === 'JOINED')).toHaveLength(20);
    expect(all.filter((r) => r.status === 'WAITLISTED')).toHaveLength(40);
    const pos = res
      .map((r) => r.json().waitlistPosition)
      .filter((p) => p !== null)
      .sort((a, b) => a - b);
    expect(pos).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    // registeredAt strictly ordered/distinct enough that (registeredAt,id) order is total
    const ts = new Set(all.map((r) => r.registeredAt.getTime()));
    expect(ts.size).toBeGreaterThan(50);
  });

  it('chaos: 300 random JOINED/LEAVE/NONE ops by 30 members + concurrent capacity PATCHes; invariants hold afterwards', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await signIns(30, 'Ch');
    const date = futureDate(DOW);
    const statuses = ['JOINED', 'LEAVE', 'NONE', 'JOINED', 'JOINED'];
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    await setCap('guild-league', 8);
    const ops: Promise<{ statusCode: number; body: string }>[] = [];
    for (let i = 0; i < 300; i++) {
      const m = ms[Math.floor(rnd() * ms.length)]!;
      ops.push(put(m.h, date, 'me', statuses[Math.floor(rnd() * statuses.length)]!));
      if (i % 25 === 0)
        ops.push(
          w.app.inject({
            method: 'PATCH',
            url: '/api/v1/admin/activities/guild-league',
            headers: admin.h,
            payload: { registrationCapacity: [3, 8, null, 5, 12][Math.floor(rnd() * 5)] },
          }),
        );
    }
    const res = await Promise.all(ops);
    expect(res.filter((r) => r.statusCode >= 500).map((r) => r.body)).toEqual([]);
    const cap = (await w.db.prisma.activity.findUniqueOrThrow({ where: { id: 'guild-league' } }))
      .registrationCapacity;
    const o = await occ();
    const all = await rows(o.id);
    const joined = all.filter((r) => r.status === 'JOINED').length;
    const wait = all.filter((r) => r.status === 'WAITLISTED').length;
    // never two rows per member (unique) and: a non-empty waitlist implies the cap is reached or exceeded
    expect(new Set(all.map((r) => r.memberId)).size).toBe(all.length);
    if (cap !== null && wait > 0) expect(joined).toBeGreaterThanOrEqual(cap);
    if (cap === null) expect(wait).toBe(0);
    // waitlist order == (registeredAt, id); GET reports contiguous positions
    const g = (
      await w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: ms[0]!.h })
    ).json();
    const list = g.occurrences[`${date}:${EV}`] ?? [];
    const positions = list
      .filter((x: { waitlistPos?: number }) => x.waitlistPos)
      .map((x: { waitlistPos: number }) => x.waitlistPos)
      .sort((a: number, b: number) => a - b);
    expect(positions).toEqual(Array.from({ length: wait }, (_, i) => i + 1));
  });

  it('same member firing JOINED, LEAVE and NONE concurrently (60 requests) ends in a consistent single state without errors', async () => {
    const [m] = await signIns(1);
    const date = futureDate(DOW);
    const res = await Promise.all(
      Array.from({ length: 60 }, (_, i) => put(m.h, date, 'me', ['JOINED', 'LEAVE', 'NONE'][i % 3]!)),
    );
    for (const r of res) expect(r.statusCode, r.body).toBe(200);
    expect(await w.db.prisma.registration.count({ where: { memberId: m.id } })).toBeLessThanOrEqual(1);
  });

  it('20 members leave at once with 20 waitlisted: each waitlisted promoted exactly once, in registration order, joined stays == capacity', async () => {
    await setCap('guild-league', 20);
    const ms = await signIns(40);
    const date = futureDate(DOW);
    for (const m of ms) await put(m.h, date, 'me', 'JOINED'); // sequential = deterministic order
    const res = await Promise.all(
      ms.slice(0, 20).flatMap((m) => [put(m.h, date, 'me', 'LEAVE'), put(m.h, date, 'me', 'LEAVE')]),
    );
    for (const r of res) expect(r.statusCode, r.body).toBe(200);
    const o = await occ();
    const all = await rows(o.id);
    expect(
      all
        .filter((r) => r.status === 'JOINED')
        .map((r) => r.memberId)
        .sort(),
    ).toEqual(
      ms
        .slice(20)
        .map((m) => m.id)
        .sort(),
    );
    expect(all.filter((r) => r.status === 'WAITLISTED')).toHaveLength(0);
    const promotes = await w.db.prisma.auditLog.count({ where: { action: 'registration.promote' } });
    expect(promotes).toBe(20);
  });
});

describe('QA AC-9 reserves order (Polarity Zone)', () => {
  it('more than 50 registrants; unplaced are reserves in registration order; leave->joined moves a reserve to the back', async () => {
    const ms = await signIns(56, 'Pz');
    const date = futureDate(6);
    for (const m of ms)
      expect((await put(m.h, date, 'me', 'JOINED', 'polarity-zone')).json().status).toBe('JOINED');
    const o = await occ('polarity-zone', date);
    const teams = await w.db.prisma.team.findMany({
      where: { room: { activityId: 'polarity-zone' } },
      orderBy: { id: 'asc' },
    });
    expect(teams.reduce((s, t) => s + t.size, 0)).toBe(50);
    let i = 0;
    for (const t of teams)
      for (let s = 1; s <= t.size; s++)
        await w.db.prisma.placement.create({
          data: { occurrenceId: o.id, memberId: ms[i++]!.id, teamId: t.id, slot: s },
        });
    const ro = async () => {
      const g = (
        await w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: ms[0]!.h })
      ).json();
      return (g.occurrences[`${date}:polarity-zone`] as { memberId: string; reserveOrder: number | null }[])
        .filter((x) => x.reserveOrder !== null)
        .sort((a, b) => a.reserveOrder! - b.reserveOrder!)
        .map((x) => x.memberId);
    };
    expect(await ro()).toEqual(ms.slice(50).map((m) => m.id));
    // R2 (ms[51]) toggles leave -> joined => back of the reserves
    await put(ms[51]!.h, date, 'me', 'LEAVE', 'polarity-zone');
    expect(await ro()).toEqual([ms[50], ms[52], ms[53], ms[54], ms[55]].map((m) => m!.id));
    await put(ms[51]!.h, date, 'me', 'JOINED', 'polarity-zone');
    expect(await ro()).toEqual([ms[50], ms[52], ms[53], ms[54], ms[55], ms[51]].map((m) => m!.id));
  });
});

describe('QA timezone / week boundaries (Asia/Bangkok, Monday first)', () => {
  afterEach(() => vi.useRealTimers());

  it('occurrence startsAt is Bangkok wall-clock for all 16 events (UTC = Bangkok - 7h), on the correct calendar date, and weekday map 0=Mon..6=Sun', async () => {
    const [m] = await signIns(1);
    const evs = await w.db.prisma.scheduleEvent.findMany();
    expect(evs).toHaveLength(16);
    for (const e of evs) {
      const date = futureDate(e.dayOfWeek);
      expect(dayOfWeekOf(date)).toBe(e.dayOfWeek);
      const r = await put(m.h, date, 'me', 'JOINED', e.id);
      expect(r.statusCode, e.id).toBe(200);
      const o = await occ(e.id, date);
      const [hh, mm] = e.startTime.split(':').map(Number);
      const want = new Date(
        `${date}T${String(hh! - 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`,
      );
      expect(o.startsAt.toISOString(), e.id).toBe(want.toISOString());
      // wrong weekday neighbours are rejected
      for (const d of [-1, 1]) {
        const bad = await put(m.h, addDays(date, d), 'me', 'JOINED', e.id);
        expect(bad.json().error.code, `${e.id} ${d}`).toBe('INVALID_OCCURRENCE_DATE');
      }
    }
  });

  it('Sunday-night / Monday-morning: the +/-56 day window flips exactly at 00:00 Bangkok (17:00Z Sunday), not at UTC midnight', async () => {
    const admin = await w.signIn({ admin: true });
    const sunLate = new Date('2026-09-20T16:59:59.000Z'); // Sunday 23:59:59 Bangkok
    const monEarly = new Date('2026-09-20T17:00:00.000Z'); // Monday 00:00:00 Bangkok
    expect(bangkokToday(sunLate)).toBe('2026-09-20');
    expect(bangkokToday(monEarly)).toBe('2026-09-21');
    const pastEdge = '2026-07-26'; // Sunday, 56 days before Sun 09-20, 57 days before Mon 09-21
    const futEdge = '2026-11-15'; // Sunday, 56 days after Sun 09-20, 55 days after Mon 09-21
    expect(dayOfWeekOf(pastEdge)).toBe(6);
    expect(dayOfWeekOf(futEdge)).toBe(6);
    const target = await w.member('WinTarget');
    vi.useFakeTimers({ toFake: ['Date'], now: sunLate });
    expect((await put(admin.h, pastEdge, target.id, 'JOINED', 'polarity-zone')).statusCode).toBe(200);
    expect((await put(admin.h, futEdge, target.id, 'JOINED', 'polarity-zone')).statusCode).toBe(200);
    expect((await put(admin.h, '2026-07-19', target.id, 'JOINED', 'polarity-zone')).json().error.code).toBe(
      'INVALID_OCCURRENCE_DATE',
    );
    expect((await put(admin.h, '2026-11-22', target.id, 'JOINED', 'polarity-zone')).json().error.code).toBe(
      'INVALID_OCCURRENCE_DATE',
    );
    vi.setSystemTime(monEarly);
    expect((await put(admin.h, pastEdge, target.id, 'NONE', 'polarity-zone')).json().error.code).toBe(
      'INVALID_OCCURRENCE_DATE',
    );
    expect((await put(admin.h, futEdge, target.id, 'NONE', 'polarity-zone')).statusCode).toBe(200);
    // GET range window follows the same boundary
    const ok = await w.app.inject({
      url: `/api/v1/registrations?from=2026-07-20&to=2026-07-26`,
      headers: admin.h,
    });
    expect(ok.statusCode).toBe(422);
  });

  it('GET /registrations groups a Mon..Sun Bangkok week correctly: Sunday 21:00 Castle Siege belongs to that Sunday, Sunday 00:00-boundary events not shifted by UTC', async () => {
    const [m] = await signIns(1);
    const sunday = futureDate(6);
    const monday = addDays(sunday, -6);
    await put(m.h, sunday, 'me', 'JOINED', 'castle-siege');
    await put(m.h, addDays(sunday, 1 + 1), 'me', 'JOINED', 'guild-league-tue-1'); // Tuesday of next week
    const wk = (
      await w.app.inject({ url: `/api/v1/registrations?from=${monday}&to=${sunday}`, headers: m.h })
    ).json();
    expect(Object.keys(wk.occurrences)).toEqual([`${sunday}:castle-siege`]);
    const next = (
      await w.app.inject({
        url: `/api/v1/registrations?from=${addDays(sunday, 1)}&to=${addDays(sunday, 7)}`,
        headers: m.h,
      })
    ).json();
    expect(Object.keys(next.occurrences)).toEqual([`${addDays(sunday, 2)}:guild-league-tue-1`]);
    const o = await occ('castle-siege', sunday);
    expect(o.startsAt.toISOString()).toBe(`${sunday}T14:00:00.000Z`); // 21:00 Bangkok
  });
});

describe('QA pool pressure', () => {
  it('150 concurrent registration writes across 3 activities on a 25-connection pool: no P2028/SERVICE_BUSY, no 5xx', async () => {
    await setCap('polarity-zone', 40);
    const ms = await signIns(150, 'Pp');
    const evs: [string, number][] = [
      ['polarity-zone', 6],
      ['guild-league-tue-1', 1],
      ['mirror-world', 3],
    ];
    const t0 = Date.now();
    const res = await Promise.all(
      ms.map((m, i) => {
        const [ev, dow] = evs[i % 3]!;
        return put(m.h, futureDate(dow), 'me', 'JOINED', ev);
      }),
    );
    console.log('150 concurrent registrations took', Date.now() - t0, 'ms');
    expect(res.filter((r) => r.statusCode !== 200).map((r) => `${r.statusCode} ${r.body}`)).toEqual([]);
    const pz = await w.db.prisma.registration.count({
      where: { occurrence: { eventId: 'polarity-zone' }, status: 'JOINED' },
    });
    expect(pz).toBe(40);
  });
});
