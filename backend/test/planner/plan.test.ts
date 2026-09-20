import { describe, expect, it } from 'vitest';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';
import { api, slots } from './helpers.js';

const w = useWorld();
const A = api(w);
const PZ = 'polarity-zone'; // Sunday (dow 6), planner, 10 teams x 5
const GL = 'guild-league-tue-1'; // Tuesday (dow 1), planner: Main 12x5 and Sub 18x5

describe('WP7a plan read', () => {
  it('everyone can read; a missing occurrence returns version 0 and the layout, and creates nothing', async () => {
    const me = await w.signIn();
    const date = futureDate(6);
    const r = await A.plan(me.h, PZ, date);
    expect(r.statusCode).toBe(200);
    const plan = r.json();
    expect(plan).toMatchObject({
      eventId: PZ,
      date,
      version: 0,
      autoBackfill: true,
      startsAt: null,
      reserves: [],
    });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]).toMatchObject({ key: 'default', capacity: 50, archived: false });
    expect(plan.rooms[0].teams).toHaveLength(10);
    expect(await w.db.prisma.occurrence.count()).toBe(0);
  });

  it('Guild League has Main 60 and Sub 90; a registration-only activity has no planner (404); bad dates are 422', async () => {
    const me = await w.signIn();
    const plan = (await A.plan(me.h, GL, futureDate(1))).json();
    expect(plan.autoBackfill).toBe(false);
    expect(plan.rooms.map((r: { key: string; capacity: number }) => [r.key, r.capacity])).toEqual([
      ['main', 60],
      ['sub', 90],
    ]);
    const none = await A.plan(me.h, 'hazy-forest', futureDate(3));
    expect(none.statusCode).toBe(404);
    expect(none.json().error.code).toBe('ACTIVITY_HAS_NO_PLANNER');
    expect((await A.plan(me.h, GL, futureDate(2))).json().error.code).toBe('INVALID_OCCURRENCE_DATE');
    expect((await A.plan(me.h, 'nope', futureDate(1))).statusCode).toBe(404);
    expect((await A.plan(me.h, GL, '2026-9-1')).statusCode).toBe(422);
  });

  it('reserves are JOINED, active, unplaced members ordered by registration time; placements carry regStatus flags', async () => {
    const admin = await w.signIn({ admin: true });
    const [placedJoined, placedLeave, placedNone, placedWait, r1, r2, r3, gone] = await A.members(8);
    const date = futureDate(6);
    const put = (m: { id: string }, status: string) =>
      w.app.inject({
        method: 'PUT',
        url: `/api/v1/events/${PZ}/occurrences/${date}/registrations/${m.id}`,
        headers: admin.h,
        payload: { status },
      });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { registrationCapacity: 6 } });
    for (const m of [r2, r1, placedJoined, placedLeave, gone, r3]) await put(m!, 'JOINED');
    await put(placedLeave!, 'LEAVE');
    await w.db.prisma.member.update({ where: { id: gone!.id }, data: { isActive: false } });
    const o = await A.occ(PZ, date);
    await w.db.prisma.registration.create({
      data: { occurrenceId: o.id, memberId: placedWait!.id, status: 'WAITLISTED', registeredAt: new Date() },
    });
    const [t1, t2] = await A.teams(PZ);
    await A.put(o.id, placedJoined!.id, t1!.id, 1);
    await A.put(o.id, placedLeave!.id, t1!.id, 2);
    await A.put(o.id, placedNone!.id, t2!.id, 1);
    await A.put(o.id, placedWait!.id, t2!.id, 2);
    const plan = (await A.plan((await w.signIn()).h, PZ, date)).json();
    const flat = plan.rooms[0].teams.flatMap(
      (t: { placements: { memberId: string; regStatus: string }[] }) => t.placements,
    );
    const st = Object.fromEntries(
      flat.map((p: { memberId: string; regStatus: string }) => [p.memberId, p.regStatus]),
    );
    expect(st).toEqual({
      [placedJoined!.id]: 'JOINED',
      [placedLeave!.id]: 'LEAVE',
      [placedNone!.id]: 'NONE',
      [placedWait!.id]: 'WAITLISTED',
    });
    // r2 registered before r1; `gone` is deactivated; placed members are not reserves
    expect(plan.reserves.map((r: { memberId: string; order: number }) => [r.memberId, r.order])).toEqual([
      [r2!.id, 1],
      [r1!.id, 2],
      [r3!.id, 3],
    ]);
  });

  it('room capacity ignores archived teams; an archived team appears only while it holds placements', async () => {
    const admin = await w.signIn({ admin: true });
    const date = futureDate(6);
    const [t1, t2] = await A.teams(PZ);
    const [m] = await A.members(1);
    const o = await w.db.prisma.occurrence.create({
      data: { eventId: PZ, date: new Date(date), startsAt: new Date(Date.now() + 5 * 86400e3) },
    });
    await A.put(o.id, m!.id, t1!.id, 1);
    await w.db.prisma.team.update({ where: { id: t1!.id }, data: { archivedAt: new Date() } });
    await w.db.prisma.team.update({ where: { id: t2!.id }, data: { archivedAt: new Date() } });
    const plan = (await A.plan(admin.h, PZ, date)).json();
    expect(plan.rooms[0].capacity).toBe(40); // 8 live teams x 5
    const ids = plan.rooms[0].teams.map((t: { id: number; archived: boolean }) => [t.id, t.archived]);
    expect(ids).toContainEqual([t1!.id, true]); // holds a placement: still rendered
    expect(ids.map((x: number[]) => x[0])).not.toContain(t2!.id); // archived and empty: hidden
  });
});

describe('WP7a placement writes', () => {
  it('non-admins get ADMIN_REQUIRED and nothing changes', async () => {
    const me = await w.signIn();
    const [m] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    const body = { teamId: t1!.id, expectedVersion: 0 };
    expect((await A.place(me.h, PZ, date, m!.id, body)).json().error.code).toBe('ADMIN_REQUIRED');
    expect((await A.clear(me.h, PZ, date, { expectedVersion: 0 })).json().error.code).toBe('ADMIN_REQUIRED');
    expect((await A.copy(me.h, PZ, date, { expectedVersion: 0 })).json().error.code).toBe('ADMIN_REQUIRED');
    expect((await A.putLayout(me.h, PZ, [])).json().error.code).toBe('ADMIN_REQUIRED');
    expect((await A.layout(me.h, PZ)).json().error.code).toBe('ADMIN_REQUIRED');
    expect(await w.db.prisma.placement.count()).toBe(0);
    expect(await w.db.prisma.occurrence.count()).toBe(0);
  });

  it('places into the lowest free slot, bumps the version, audits, and lazily creates the occurrence', async () => {
    const admin = await w.signIn({ admin: true });
    const [a, b, c] = await A.members(3);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    const r1 = await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 });
    expect(r1.json()).toEqual({ version: 1 });
    expect((await A.place(admin.h, PZ, date, b!.id, { teamId: t1!.id, expectedVersion: 1 })).json()).toEqual({
      version: 2,
    });
    await A.place(admin.h, PZ, date, c!.id, { teamId: t1!.id, slot: 5, expectedVersion: 2 });
    const plan = (await A.plan(admin.h, PZ, date)).json();
    expect(plan.version).toBe(3);
    expect(slots(plan)).toEqual({ [a!.id]: [t1!.id, 1], [b!.id]: [t1!.id, 2], [c!.id]: [t1!.id, 5] });
    expect(plan.rooms[0].teams[0].placements.every((p: { source: string }) => p.source === 'ADMIN')).toBe(
      true,
    );
    const log = await w.db.prisma.auditLog.findMany({ where: { action: 'plan.place' } });
    expect(log).toHaveLength(3);
    expect(log[0]!.actorId).toBe(admin.id);
    expect(log[0]!.meta).toMatchObject({ memberId: a!.id, from: null, to: { teamId: t1!.id, slot: 1 } });
  });

  it('a full team gives TEAM_FULL; slots outside 1..size give SLOT_OUT_OF_RANGE; nothing is written on errors', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await A.members(7);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    let v = 0;
    for (const m of ms.slice(0, 5))
      v = (await A.place(admin.h, PZ, date, m.id, { teamId: t1!.id, expectedVersion: v })).json().version;
    const full = await A.place(admin.h, PZ, date, ms[5]!.id, { teamId: t1!.id, expectedVersion: v });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('TEAM_FULL');
    for (const slot of [0, 6, -1]) {
      const r = await A.place(admin.h, PZ, date, ms[5]!.id, { teamId: t1!.id, slot, expectedVersion: v });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe('SLOT_OUT_OF_RANGE');
    }
    expect((await A.plan(admin.h, PZ, date)).json().version).toBe(v);
    expect(await w.db.prisma.placement.count()).toBe(5);
  });

  it('team and member validation: other activity, unknown/archived team, unknown or deactivated member', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await A.members(1);
    const gone = await w.member('Gone', { isActive: false });
    const date = futureDate(6);
    const glTeam = (await A.teams('guild-league'))[0]!;
    const [t1, t2] = await A.teams(PZ);
    const p = (memberId: string, teamId: number) =>
      A.place(admin.h, PZ, date, memberId, { teamId, expectedVersion: 0 });
    expect((await p(m!.id, glTeam.id)).json().error.code).toBe('TEAM_NOT_IN_ACTIVITY');
    expect((await p(m!.id, 999999)).statusCode).toBe(404);
    await w.db.prisma.team.update({ where: { id: t2!.id }, data: { archivedAt: new Date() } });
    expect((await p(m!.id, t2!.id)).statusCode).toBe(404);
    expect((await p(gone.id, t1!.id)).json().error.code).toBe('MEMBER_INACTIVE');
    expect((await p('00000000-0000-4000-8000-000000000000', t1!.id)).json().error.code).toBe(
      'MEMBER_NOT_FOUND',
    );
    expect(
      (await A.place(admin.h, PZ, date, m!.id, { teamId: null, slot: 2, expectedVersion: 0 })).statusCode,
    ).toBe(422);
    expect(await w.db.prisma.placement.count()).toBe(0);
  });

  it('a member holds one slot per occurrence across Main and Sub: placing again moves them', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await A.members(1);
    const teams = await A.teams('guild-league');
    const rooms = await w.db.prisma.room.findMany({
      where: { activityId: 'guild-league' },
      orderBy: { id: 'asc' },
    });
    const main = teams.find((t) => t.roomId === rooms[0]!.id)!;
    const sub = teams.find((t) => t.roomId === rooms[1]!.id)!;
    const date = futureDate(1);
    await A.place(admin.h, GL, date, m!.id, { teamId: main.id, expectedVersion: 0 });
    await A.place(admin.h, GL, date, m!.id, { teamId: sub.id, slot: 3, expectedVersion: 1 });
    const o = await A.occ(GL, date);
    const rows = await w.db.prisma.placement.findMany({ where: { occurrenceId: o.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: sub.id, slot: 3 });
    // a different occurrence (the other Guild League slot on the same day is another event) is independent
    await A.place(admin.h, 'guild-league-tue-2', date, m!.id, { teamId: main.id, expectedVersion: 0 });
    expect(await w.db.prisma.placement.count()).toBe(2);
  });

  it('a stale expectedVersion gives PLAN_VERSION_CONFLICT carrying the current plan; nothing changes', async () => {
    const admin = await w.signIn({ admin: true });
    const [a, b] = await A.members(2);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 });
    const stale = await A.place(admin.h, PZ, date, b!.id, { teamId: t1!.id, expectedVersion: 0 });
    expect(stale.statusCode).toBe(409);
    const err = stale.json().error;
    expect(err.code).toBe('PLAN_VERSION_CONFLICT');
    expect(err.details.currentVersion).toBe(1);
    expect(slots(err.details.plan)).toEqual({ [a!.id]: [t1!.id, 1] });
    expect(await w.db.prisma.placement.count()).toBe(1);
    // clear and copy check the version too
    expect((await A.clear(admin.h, PZ, date, { expectedVersion: 0 })).json().error.code).toBe(
      'PLAN_VERSION_CONFLICT',
    );
    expect((await A.copy(admin.h, PZ, date, { expectedVersion: 5 })).json().error.code).toBe(
      'PLAN_VERSION_CONFLICT',
    );
    expect(await w.db.prisma.placement.count()).toBe(1);
  });

  it('a stale version against a not-yet-existing occurrence creates nothing', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const r = await A.place(admin.h, PZ, futureDate(6), a!.id, { teamId: t1!.id, expectedVersion: 3 });
    expect(r.json().error.code).toBe('PLAN_VERSION_CONFLICT');
    expect(await w.db.prisma.occurrence.count()).toBe(0);
  });

  it('dropping a member on an occupied slot swaps the two in one transaction (one version bump)', async () => {
    const admin = await w.signIn({ admin: true });
    const [a, b, c] = await A.members(3);
    const [t1, t2] = await A.teams(PZ);
    const date = futureDate(6);
    await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, slot: 1, expectedVersion: 0 });
    await A.place(admin.h, PZ, date, b!.id, { teamId: t2!.id, slot: 4, expectedVersion: 1 });
    const swap = await A.place(admin.h, PZ, date, a!.id, { teamId: t2!.id, slot: 4, expectedVersion: 2 });
    expect(swap.json()).toEqual({ version: 3 });
    let plan = (await A.plan(admin.h, PZ, date)).json();
    expect(slots(plan)).toEqual({ [a!.id]: [t2!.id, 4], [b!.id]: [t1!.id, 1] });
    expect(
      (await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'plan.move' } })).meta,
    ).toMatchObject({
      swappedWith: b!.id,
    });
    // an unplaced member dropped on an occupied slot takes it; the occupant becomes unplaced
    await A.place(admin.h, PZ, date, c!.id, { teamId: t2!.id, slot: 4, expectedVersion: 3 });
    plan = (await A.plan(admin.h, PZ, date)).json();
    expect(slots(plan)).toEqual({ [c!.id]: [t2!.id, 4], [b!.id]: [t1!.id, 1] });
    expect(await w.db.prisma.placement.count()).toBe(2);
  });

  it('move, unplace and no-op semantics: a no-op does not bump the version; unplacing never backfills', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1, t2] = await A.teams(PZ);
    const date = futureDate(6);
    await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 }); // v1
    // slot omitted while already in the team: no-op
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 1 })).json()).toEqual({
      version: 1,
    });
    // same explicit slot: no-op
    expect(
      (await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, slot: 1, expectedVersion: 1 })).json(),
    ).toEqual({ version: 1 });
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: t2!.id, expectedVersion: 1 })).json()).toEqual({
      version: 2,
    });
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: null, expectedVersion: 2 })).json()).toEqual({
      version: 3,
    });
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: null, expectedVersion: 3 })).json()).toEqual({
      version: 3,
    });
    expect(await w.db.prisma.placement.count()).toBe(0);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.unplace' } })).toBe(1);
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
  });

  it('placing a member who is not registered as joined is allowed (warning via regStatus, never blocked)', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 })).statusCode).toBe(
      200,
    );
    const plan = (await A.plan(admin.h, PZ, date)).json();
    expect(plan.rooms[0].teams[0].placements[0].regStatus).toBe('NONE');
  });

  it('clear removes every placement with one version bump; clearing an empty plan changes nothing', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await A.members(3);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    let v = 0;
    for (const m of ms)
      v = (await A.place(admin.h, PZ, date, m.id, { teamId: t1!.id, expectedVersion: v })).json().version;
    expect((await A.clear(admin.h, PZ, date, { expectedVersion: v })).json()).toEqual({
      version: v + 1,
      removed: 3,
    });
    expect((await A.clear(admin.h, PZ, date, { expectedVersion: v + 1 })).json()).toEqual({
      version: v + 1,
      removed: 0,
    });
    expect(await w.db.prisma.placement.count()).toBe(0);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.clear' } })).toBe(1);
  });

  it('an admin can still edit a plan after the occurrence started', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const past = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    // find the most recent Sunday strictly before today
    let d = new Date(`${past}T00:00:00Z`);
    while (d.getUTCDay() !== 0) d = new Date(d.getTime() - 86400e3);
    const date = d.toISOString().slice(0, 10);
    expect((await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 })).statusCode).toBe(
      200,
    );
  });
});
