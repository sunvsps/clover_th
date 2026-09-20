import { describe, expect, it } from 'vitest';
import { withActivityLock } from '../../src/lib/locks.js';
import { futureDate, pastDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const EV = 'guild-league-tue-1'; // Tuesday (dow 1), activity guild-league
const DOW = 1;
type H = Record<string, string>;

const put = (h: H, date: string, who: string, status: string, event = EV) =>
  w.app.inject({
    method: 'PUT',
    url: `/api/v1/events/${event}/occurrences/${date}/registrations/${who}`,
    headers: h,
    payload: { status },
  });
const reg = (occId: number, memberId: string) =>
  w.db.prisma.registration.findUnique({
    where: { occurrenceId_memberId: { occurrenceId: occId, memberId } },
  });
const occ = async (event = EV, date = futureDate(DOW)) =>
  w.db.prisma.occurrence.findFirstOrThrow({ where: { eventId: event, date: new Date(date) } });
const setCap = (id: string, registrationCapacity: number | null) =>
  w.db.prisma.activity.update({ where: { id }, data: { registrationCapacity } });
const members = async (n: number, prefix = 'M') =>
  Promise.all(Array.from({ length: n }, (_, i) => w.member(`${prefix}${i}`)));
const counts = async (occurrenceId: number) => ({
  joined: await w.db.prisma.registration.count({ where: { occurrenceId, status: 'JOINED' } }),
  waitlisted: await w.db.prisma.registration.count({ where: { occurrenceId, status: 'WAITLISTED' } }),
});

describe('WP6 registration basics', () => {
  it('a member changes only their own status; an admin can change anyone; others get FORBIDDEN_OTHER_MEMBER', async () => {
    const a = await w.signIn();
    const b = await w.signIn();
    const admin = await w.signIn({ admin: true });
    const date = futureDate(DOW);
    expect((await put(a.h, date, 'me', 'JOINED')).json().status).toBe('JOINED');
    expect((await put(a.h, date, a.id, 'LEAVE')).json().status).toBe('LEAVE');
    const denied = await put(a.h, date, b.id, 'JOINED');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN_OTHER_MEMBER');
    expect(await w.db.prisma.registration.count({ where: { memberId: b.id } })).toBe(0);
    expect((await put(admin.h, date, b.id, 'JOINED')).json().status).toBe('JOINED');
    const audit = await w.db.prisma.auditLog.findFirstOrThrow({
      where: { action: 'registration.set', actorId: admin.id },
    });
    expect(audit.meta).toMatchObject({ memberId: b.id, from: 'NONE', to: 'JOINED' });
  });

  it('repeating a PUT changes nothing (same registeredAt, no extra audit); response envelope is stable', async () => {
    const a = await w.signIn();
    const date = futureDate(DOW);
    const first = await put(a.h, date, 'me', 'JOINED');
    expect(first.json()).toMatchObject({
      status: 'JOINED',
      waitlistPosition: null,
      promoted: [],
      backfilled: [],
      planVersion: 0,
    });
    const o = await occ();
    const r1 = await reg(o.id, a.id);
    const audits = await w.db.prisma.auditLog.count();
    const second = await put(a.h, date, 'me', 'JOINED');
    expect(second.json()).toEqual(first.json());
    expect((await reg(o.id, a.id))!.registeredAt).toEqual(r1!.registeredAt);
    expect(await w.db.prisma.auditLog.count()).toBe(audits);
  });

  it('LEAVE from none creates a LEAVE row; NONE deletes the row; NONE when none is a no-op', async () => {
    const a = await w.signIn();
    const date = futureDate(DOW);
    expect((await put(a.h, date, 'me', 'NONE')).json().status).toBe('NONE');
    expect((await put(a.h, date, 'me', 'LEAVE')).json().status).toBe('LEAVE');
    const o = await occ();
    expect((await reg(o.id, a.id))!.status).toBe('LEAVE');
    expect((await put(a.h, date, 'me', 'NONE')).json().status).toBe('NONE');
    expect(await reg(o.id, a.id)).toBeNull();
  });

  it('leave to joined resets registeredAt', async () => {
    const a = await w.signIn();
    const date = futureDate(DOW);
    await put(a.h, date, 'me', 'JOINED');
    const o = await occ();
    const t1 = (await reg(o.id, a.id))!.registeredAt;
    await put(a.h, date, 'me', 'LEAVE');
    await new Promise((r) => setTimeout(r, 15));
    await put(a.h, date, 'me', 'JOINED');
    expect((await reg(o.id, a.id))!.registeredAt.getTime()).toBeGreaterThan(t1.getTime());
  });

  it('Polarity Zone accepts more than 50 registrations (no capacity by default)', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await members(60);
    const date = futureDate(6);
    const rs = await Promise.all(ms.map((m) => put(admin.h, date, m.id, 'JOINED', 'polarity-zone')));
    expect(rs.every((r) => r.statusCode === 200 && r.json().status === 'JOINED')).toBe(true);
    expect((await counts((await occ('polarity-zone', date)).id)).joined).toBe(60);
  });

  it('a deactivated or unknown target member is refused', async () => {
    const admin = await w.signIn({ admin: true });
    const gone = await w.member('Gone', { isActive: false });
    const date = futureDate(DOW);
    const r = await put(admin.h, date, gone.id, 'JOINED');
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('MEMBER_INACTIVE');
    expect(
      (await put(admin.h, date, '00000000-0000-4000-8000-000000000000', 'JOINED')).json().error.code,
    ).toBe('MEMBER_NOT_FOUND');
  });
});

describe('WP6 dates and the after-start rule', () => {
  it('a non-admin change after startsAt gives REGISTRATION_CLOSED (nothing written); an admin may still change it', async () => {
    const a = await w.signIn();
    const admin = await w.signIn({ admin: true });
    const date = pastDate(DOW);
    const r = await put(a.h, date, 'me', 'JOINED');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('REGISTRATION_CLOSED');
    expect(await w.db.prisma.occurrence.count()).toBe(0);
    expect((await put(admin.h, date, a.id, 'JOINED')).json().status).toBe('JOINED');
  });

  it('wrong weekday, out-of-window, malformed and impossible dates and unknown events are rejected', async () => {
    const a = await w.signIn();
    const bad = await put(a.h, futureDate(2), 'me', 'JOINED');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('INVALID_OCCURRENCE_DATE');
    expect((await put(a.h, futureDate(DOW, 12), 'me', 'JOINED')).json().error.code).toBe(
      'INVALID_OCCURRENCE_DATE',
    );
    expect((await put(a.h, '2026-9-1', 'me', 'JOINED')).json().error.code).toBe('VALIDATION_ERROR');
    expect((await put(a.h, '2026-02-30', 'me', 'JOINED')).json().error.code).toBe('INVALID_OCCURRENCE_DATE');
    expect((await put(a.h, futureDate(DOW), 'me', 'JOINED', 'no-such-event')).statusCode).toBe(404);
    expect(await w.db.prisma.occurrence.count()).toBe(0);
  });

  it('occurrence date and startsAt follow Asia/Bangkok, including an event just after midnight', async () => {
    const a = await w.signIn();
    await w.db.prisma.activity.create({ data: { id: 'midnight', name: 'Midnight' } });
    await w.db.prisma.scheduleEvent.create({
      data: { id: 'midnight-ev', activityId: 'midnight', dayOfWeek: 0, startTime: '00:30', endTime: '01:00' },
    });
    const monday = futureDate(0);
    expect((await put(a.h, monday, 'me', 'JOINED', 'midnight-ev')).statusCode).toBe(200);
    const [row] = await w.db.prisma.$queryRaw<
      { date: string; startsAt: Date }[]
    >`SELECT to_char(date, 'YYYY-MM-DD') AS date, "startsAt" FROM "Occurrence"`;
    expect(row!.date).toBe(monday);
    // 00:30 Bangkok Monday is 17:30 UTC on the previous day
    const prev = new Date(`${monday}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    expect(row!.startsAt.toISOString()).toBe(`${prev.toISOString().slice(0, 10)}T17:30:00.000Z`);
    const list = await w.app.inject({
      url: `/api/v1/registrations?from=${monday}&to=${monday}`,
      headers: a.h,
    });
    expect(Object.keys(list.json().occurrences)).toEqual([`${monday}:midnight-ev`]);
  });
});

describe('WP6 capacity and the waitlist', () => {
  it('with capacity 2 and three registrations the third is WAITLISTED, with its position', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 2);
    const [a, b, c, d] = await members(4);
    const date = futureDate(DOW);
    const res = [];
    for (const m of [a, b, c, d]) res.push((await put(admin.h, date, m!.id, 'JOINED')).json());
    expect(res.map((r) => r.status)).toEqual(['JOINED', 'JOINED', 'WAITLISTED', 'WAITLISTED']);
    expect(res.map((r) => r.waitlistPosition)).toEqual([null, null, 1, 2]);
  });

  it('a WAITLISTED member requesting JOINED again is a no-op (keeps registeredAt and position)', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 1);
    const [a, b] = await members(2);
    const date = futureDate(DOW);
    await put(admin.h, date, a!.id, 'JOINED');
    await put(admin.h, date, b!.id, 'JOINED');
    const o = await occ();
    const before = await reg(o.id, b!.id);
    const again = await put(admin.h, date, b!.id, 'JOINED');
    expect(again.json()).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1, promoted: [] });
    expect((await reg(o.id, b!.id))!.registeredAt).toEqual(before!.registeredAt);
  });

  it('unregistering a joined member promotes the oldest waitlisted, keeping its registeredAt; a waitlisted leaver frees nothing', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 1);
    const [a, b, c] = await members(3);
    const date = futureDate(DOW);
    for (const m of [a, b, c]) await put(admin.h, date, m!.id, 'JOINED');
    const o = await occ();
    const bTime = (await reg(o.id, b!.id))!.registeredAt;
    // waitlisted leaver frees nothing
    expect((await put(admin.h, date, c!.id, 'NONE')).json().promoted).toEqual([]);
    const r = await put(admin.h, date, a!.id, 'NONE');
    expect(r.json().promoted).toEqual([b!.id]);
    const promoted = await reg(o.id, b!.id);
    expect(promoted).toMatchObject({ status: 'JOINED', updatedById: null });
    expect(promoted!.registeredAt).toEqual(bTime);
  });

  it('10 concurrent unregisters of one joined member promote exactly one waitlisted member', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 2);
    const [a, b, c, d] = await members(4);
    const date = futureDate(DOW);
    for (const m of [a, b, c, d]) await put(admin.h, date, m!.id, 'JOINED');
    const o = await occ();
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => put(admin.h, date, a!.id, i % 2 ? 'LEAVE' : 'NONE')),
    );
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.flatMap((r) => r.json().promoted)).toEqual([c!.id]); // exactly one promotion across all responses
    expect((await reg(o.id, c!.id))!.status).toBe('JOINED');
    expect((await reg(o.id, d!.id))!.status).toBe('WAITLISTED');
    expect(await counts(o.id)).toEqual({ joined: 2, waitlisted: 1 });
    expect(await w.db.prisma.auditLog.count({ where: { action: 'registration.promote' } })).toBe(1);
  });

  it('two joined members withdrawing concurrently (5 requests each) promote exactly two, in order', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 2);
    const [a, b, c, d, e] = await members(5);
    const date = futureDate(DOW);
    for (const m of [a, b, c, d, e]) await put(admin.h, date, m!.id, 'JOINED');
    const o = await occ();
    const rs = await Promise.all(
      [a, b].flatMap((m) => Array.from({ length: 5 }, () => put(admin.h, date, m!.id, 'NONE'))),
    );
    expect(rs.flatMap((r) => r.json().promoted).sort()).toEqual([c!.id, d!.id].sort());
    expect(await counts(o.id)).toEqual({ joined: 2, waitlisted: 1 });
    expect((await reg(o.id, e!.id))!.status).toBe('WAITLISTED');
  });

  it('50 concurrent registrations with capacity 10 give exactly 10 JOINED and 40 WAITLISTED with distinct positions', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 10);
    const ms = await members(50);
    const date = futureDate(DOW);
    const rs = await Promise.all(ms.map((m) => put(admin.h, date, m.id, 'JOINED')));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const o = await occ();
    expect(await counts(o.id)).toEqual({ joined: 10, waitlisted: 40 });
    const pos = rs
      .filter((r) => r.json().status === 'WAITLISTED')
      .map((r) => r.json().waitlistPosition)
      .sort((x, y) => x - y);
    expect(pos).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('10 concurrent identical registrations of one member create one row with a stable registeredAt', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await members(1);
    const date = futureDate(DOW);
    const rs = await Promise.all(Array.from({ length: 10 }, () => put(admin.h, date, a!.id, 'JOINED')));
    expect(rs.every((r) => r.json().status === 'JOINED')).toBe(true);
    expect(await w.db.prisma.registration.count()).toBe(1);
    expect(await w.db.prisma.occurrence.count()).toBe(1);
  });
});

describe('WP6 activity settings and the Activity lock (B1)', () => {
  it('registration and settings writes wait while the Activity lock is held, including for an occurrence that does not exist yet', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await members(1);
    const date = futureDate(DOW, 2); // not created yet
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = w.app.tx(async (tx) => {
      await withActivityLock(tx, 'guild-league');
      locked();
      await gate;
    });
    await isLocked;

    let regDone = false;
    let patchDone = false;
    const regP = put(admin.h, date, a!.id, 'JOINED').then((r) => ((regDone = true), r));
    const patchP = w.app
      .inject({
        method: 'PATCH',
        url: '/api/v1/admin/activities/guild-league',
        headers: admin.h,
        payload: { registrationCapacity: 5 },
      })
      .then((r) => ((patchDone = true), r));
    // a different activity is not blocked
    const other = await put(admin.h, futureDate(3), a!.id, 'JOINED', 'mirror-world');
    expect(other.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(regDone).toBe(false);
    expect(patchDone).toBe(false);
    expect(await w.db.prisma.occurrence.count({ where: { eventId: EV } })).toBe(0);
    release();
    await holder;
    expect((await regP).statusCode).toBe(200);
    expect((await patchP).statusCode).toBe(200);
  });

  it('a capacity raise racing concurrent registrations on a not-yet-existing occurrence never leaves anyone waitlisted below capacity', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await members(3);
    for (let round = 1; round <= 6; round++) {
      await setCap('guild-league', 1);
      const date = futureDate(DOW, round + 1);
      await Promise.all([
        ...ms.map((m) => put(admin.h, date, m.id, 'JOINED')),
        w.app.inject({
          method: 'PATCH',
          url: '/api/v1/admin/activities/guild-league',
          headers: admin.h,
          payload: { registrationCapacity: 3 },
        }),
      ]);
      const o = await occ(EV, date);
      expect(await counts(o.id)).toEqual({ joined: 3, waitlisted: 0 });
    }
  });

  it('raising the capacity promotes waitlisted members across all future occurrences; lowering never demotes; past ones are untouched', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('guild-league', 1);
    const [a, b, c, d] = await members(4);
    const d1 = futureDate(DOW, 1);
    const d2 = futureDate(DOW, 2);
    for (const date of [d1, d2]) for (const m of [a, b, c]) await put(admin.h, date, m!.id, 'JOINED');
    // an already-started occurrence with a waitlist
    const pastO = await w.db.prisma.occurrence.create({
      data: { eventId: EV, date: new Date(pastDate(DOW)), startsAt: new Date(Date.now() - 86400e3) },
    });
    await w.db.prisma.registration.createMany({
      data: [
        { occurrenceId: pastO.id, memberId: a!.id, status: 'JOINED', registeredAt: new Date() },
        { occurrenceId: pastO.id, memberId: d!.id, status: 'WAITLISTED', registeredAt: new Date() },
      ],
    });
    const r = await w.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/activities/guild-league',
      headers: admin.h,
      payload: { registrationCapacity: 2 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().promoted).toHaveLength(2); // one per future occurrence
    for (const date of [d1, d2])
      expect(await counts((await occ(EV, date)).id)).toEqual({ joined: 2, waitlisted: 1 });
    expect((await reg(pastO.id, d!.id))!.status).toBe('WAITLISTED');
    // lowering never demotes
    const low = await w.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/activities/guild-league',
      headers: admin.h,
      payload: { registrationCapacity: 1 },
    });
    expect(low.json().promoted).toEqual([]);
    expect(await counts((await occ(EV, d1)).id)).toEqual({ joined: 2, waitlisted: 1 });
    // removing the capacity promotes everyone
    await w.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/activities/guild-league',
      headers: admin.h,
      payload: { registrationCapacity: null },
    });
    expect(await counts((await occ(EV, d1)).id)).toEqual({ joined: 3, waitlisted: 0 });
  });

  it('PATCH validation: non-admin, empty body, unknown field, bad channel, autoBackfill without a planner', async () => {
    const admin = await w.signIn({ admin: true });
    const me = await w.signIn();
    const patch = (h: H, id: string, payload: object) =>
      w.app.inject({ method: 'PATCH', url: `/api/v1/admin/activities/${id}`, headers: h, payload });
    expect((await patch(me.h, 'guild-league', { registrationCapacity: 5 })).json().error.code).toBe(
      'ADMIN_REQUIRED',
    );
    expect((await patch(admin.h, 'guild-league', {})).statusCode).toBe(422);
    expect((await patch(admin.h, 'guild-league', { name: 'x' })).statusCode).toBe(422);
    expect((await patch(admin.h, 'guild-league', { notifyChannelId: 'abc' })).statusCode).toBe(422);
    expect((await patch(admin.h, 'guild-league', { registrationCapacity: 0 })).statusCode).toBe(422);
    const nb = await patch(admin.h, 'hazy-forest', { autoBackfill: true });
    expect(nb.statusCode).toBe(422);
    expect(nb.json().error.code).toBe('AUTO_BACKFILL_REQUIRES_PLANNER');
    expect((await patch(admin.h, 'no-such', { registrationCapacity: 5 })).statusCode).toBe(404);
    expect(
      (await w.db.prisma.activity.findUniqueOrThrow({ where: { id: 'hazy-forest' } })).autoBackfill,
    ).toBe(false);
  });

  it('PATCH applies capacity, autoBackfill and channel, audits before/after, and is a no-op when nothing changes', async () => {
    const admin = await w.signIn({ admin: true });
    const patch = (id: string, payload: object) =>
      w.app.inject({ method: 'PATCH', url: `/api/v1/admin/activities/${id}`, headers: admin.h, payload });
    const r = await patch('guild-league', {
      registrationCapacity: 80,
      autoBackfill: true,
      notifyChannelId: '123456789012345678',
    });
    expect(r.json().activity).toMatchObject({
      registrationCapacity: 80,
      autoBackfill: true,
      notifyChannelId: '123456789012345678',
      layoutCapacity: 150,
    });
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'activity.update' } });
    expect(log.meta).toMatchObject({
      changes: { registrationCapacity: { from: null, to: 80 }, autoBackfill: { from: false, to: true } },
    });
    const n = await w.db.prisma.auditLog.count();
    await patch('guild-league', { registrationCapacity: 80 });
    expect(await w.db.prisma.auditLog.count()).toBe(n);
    expect(
      (await patch('guild-league', { notifyChannelId: null })).json().activity.notifyChannelId,
    ).toBeNull();
  });
});

describe('WP6 reads', () => {
  it('GET /events returns the 16 schedule rows; GET /activities hides notifyChannelId from non-admins', async () => {
    const me = await w.signIn();
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({
      where: { id: 'guild-league' },
      data: { notifyChannelId: '123456789012345678' },
    });
    const events = (await w.app.inject({ url: '/api/v1/events', headers: me.h })).json();
    expect(events).toHaveLength(16);
    expect(events.find((e: { id: string }) => e.id === 'guild-league-thu')).toMatchObject({
      activityId: 'guild-league',
      name: 'Guild League',
      isGuild: true,
      dayOfWeek: 3,
      startTime: '22:00',
      endTime: '22:25',
    });
    const asMember = (await w.app.inject({ url: '/api/v1/activities', headers: me.h })).json();
    const asAdmin = (await w.app.inject({ url: '/api/v1/activities', headers: admin.h })).json();
    expect(asMember).toHaveLength(14);
    expect(asMember.every((a: object) => !('notifyChannelId' in a))).toBe(true);
    expect(asAdmin.find((a: { id: string }) => a.id === 'guild-league').notifyChannelId).toBe(
      '123456789012345678',
    );
    const caps = Object.fromEntries(
      asMember.map((a: { id: string; layoutCapacity: number }) => [a.id, a.layoutCapacity]),
    );
    expect(caps).toMatchObject({
      'guild-league': 150,
      'polarity-zone': 50,
      'mirror-world': 40,
      'castle-siege': 40,
      'hazy-forest': 0,
    });
  });

  it('GET /registrations never creates occurrences and returns empty data for missing ones', async () => {
    const me = await w.signIn();
    const date = futureDate(DOW);
    const r = await w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: me.h });
    expect(r.statusCode).toBe(200);
    expect(r.json().occurrences).toEqual({});
    expect(await w.db.prisma.occurrence.count()).toBe(0);
    // and reading an existing range does not create either
    await put(me.h, date, 'me', 'JOINED');
    await w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: me.h });
    expect(await w.db.prisma.occurrence.count()).toBe(1);
  });

  it('GET /registrations returns statuses keyed date:eventId, waitlist positions, and placed/reserveOrder for planner activities', async () => {
    const admin = await w.signIn({ admin: true });
    await setCap('polarity-zone', 3);
    const [a, b, c, d, e] = await members(5);
    const date = futureDate(6);
    for (const m of [a, b, c, d, e]) await put(admin.h, date, m!.id, 'JOINED', 'polarity-zone');
    await put(admin.h, date, b!.id, 'LEAVE', 'polarity-zone'); // frees a seat: d gets promoted (oldest waitlisted)
    const o = await occ('polarity-zone', date);
    const team = await w.db.prisma.team.findFirstOrThrow({
      where: { room: { activityId: 'polarity-zone' } },
    });
    await w.db.prisma.placement.create({
      data: { occurrenceId: o.id, memberId: a!.id, teamId: team.id, slot: 1 },
    });
    const r = (
      await w.app.inject({ url: `/api/v1/registrations?from=${date}&to=${date}`, headers: admin.h })
    ).json();
    const list = r.occurrences[`${date}:polarity-zone`] as {
      memberId: string;
      status: string;
      waitlistPos?: number;
      placed?: boolean;
      reserveOrder?: number | null;
    }[];
    const by = Object.fromEntries(list.map((x) => [x.memberId, x]));
    expect(by[a!.id]).toMatchObject({ status: 'JOINED', placed: true, reserveOrder: null });
    expect(by[b!.id]).toMatchObject({ status: 'LEAVE', placed: false, reserveOrder: null });
    expect(by[c!.id]).toMatchObject({ status: 'JOINED', placed: false, reserveOrder: 1 });
    expect(by[d!.id]).toMatchObject({ status: 'JOINED', placed: false, reserveOrder: 2 });
    expect(by[e!.id]).toMatchObject({ status: 'WAITLISTED', waitlistPos: 1 });
    expect(new Date(r.serverTime).toISOString()).toBe(r.serverTime);
  });

  it('GET /registrations limits the range to 14 days and to the window, and validates order', async () => {
    const me = await w.signIn();
    const from = futureDate(0);
    const get = (f: string, t: string) =>
      w.app.inject({ url: `/api/v1/registrations?from=${f}&to=${t}`, headers: me.h });
    const to14 = futureDate(6, 2); // 13 days after `from` when from is a Monday and to the Sunday two weeks on
    expect((await get(from, to14)).statusCode).toBe(200);
    expect((await get(from, futureDate(0, 3))).statusCode).toBe(422); // 15 days
    expect((await get(to14, from)).statusCode).toBe(422);
    expect((await get('2020-01-01', '2020-01-02')).json().error.code).toBe('INVALID_OCCURRENCE_DATE');
    expect((await get('nope', 'nope')).statusCode).toBe(422);
  });
});
