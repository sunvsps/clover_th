import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/time.js';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';
import { api, slots } from './helpers.js';

const w = useWorld();
const A = api(w);
const PZ = 'polarity-zone';

/** Source occurrence one week before `date`, with the given placements. */
async function withSource(date: string, rows: { memberId: string; teamId: number; slot: number }[]) {
  const src = await w.db.prisma.occurrence.create({
    data: { eventId: PZ, date: new Date(addDays(date, -7)), startsAt: new Date(Date.now() + 86400e3) },
  });
  for (const r of rows) await A.put(src.id, r.memberId, r.teamId, r.slot);
  return src;
}

describe('WP7a copy-from-previous', () => {
  it('copies last week, flags members no longer joined through regStatus, skips deactivated members and vanished teams/slots', async () => {
    const admin = await w.signIn({ admin: true });
    const [joined, left, none, gone, removedTeam, bigSlot] = await A.members(6);
    const [t1, t2, t3] = await A.teams(PZ);
    const date = futureDate(6);
    const src = await withSource(date, [
      { memberId: joined!.id, teamId: t1!.id, slot: 1 },
      { memberId: left!.id, teamId: t1!.id, slot: 2 },
      { memberId: none!.id, teamId: t2!.id, slot: 1 },
      { memberId: gone!.id, teamId: t2!.id, slot: 2 },
      { memberId: removedTeam!.id, teamId: t3!.id, slot: 1 },
      { memberId: bigSlot!.id, teamId: t2!.id, slot: 5 },
    ]);
    void src;
    // this week: joined is JOINED, left is on LEAVE, none never registered
    const reg = (m: { id: string }, status: string) =>
      w.app.inject({
        method: 'PUT',
        url: `/api/v1/events/${PZ}/occurrences/${date}/registrations/${m.id}`,
        headers: admin.h,
        payload: { status },
      });
    await reg(joined!, 'JOINED');
    await reg(left!, 'LEAVE');
    await w.db.prisma.member.update({ where: { id: gone!.id }, data: { isActive: false } });
    await w.db.prisma.team.update({ where: { id: t3!.id }, data: { archivedAt: new Date() } });
    await w.db.prisma.team.update({ where: { id: t2!.id }, data: { size: 4 } });

    const v = (await A.plan(admin.h, PZ, date)).json().version;
    const r = await A.copy(admin.h, PZ, date, { expectedVersion: v });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.copied).toBe(3);
    expect(body.version).toBe(v + 1);
    expect(body.skipped).toEqual(
      expect.arrayContaining([
        { memberId: gone!.id, reason: 'MEMBER_INACTIVE' },
        { memberId: removedTeam!.id, reason: 'TEAM_REMOVED' },
        { memberId: bigSlot!.id, reason: 'SLOT_OUT_OF_RANGE' },
      ]),
    );
    expect(body.skipped).toHaveLength(3);
    const plan = (await A.plan(admin.h, PZ, date)).json();
    expect(slots(plan)).toEqual({
      [joined!.id]: [t1!.id, 1],
      [left!.id]: [t1!.id, 2],
      [none!.id]: [t2!.id, 1],
    });
    const flat = plan.rooms[0].teams.flatMap(
      (t: { placements: { memberId: string; regStatus: string; source: string }[] }) => t.placements,
    );
    const flags = Object.fromEntries(
      flat.map((p: { memberId: string; regStatus: string }) => [p.memberId, p.regStatus]),
    );
    expect(flags).toEqual({ [joined!.id]: 'JOINED', [left!.id]: 'LEAVE', [none!.id]: 'NONE' });
    expect(flat.every((p: { source: string }) => p.source === 'COPY')).toBe(true);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.copy' } })).toBe(1);
  });

  it('a non-empty target plan gives PLAN_NOT_EMPTY; clear first, then copy works', async () => {
    const admin = await w.signIn({ admin: true });
    const [a, b] = await A.members(2);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    await withSource(date, [{ memberId: a!.id, teamId: t1!.id, slot: 1 }]);
    await A.place(admin.h, PZ, date, b!.id, { teamId: t1!.id, expectedVersion: 0 });
    const r = await A.copy(admin.h, PZ, date, { expectedVersion: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('PLAN_NOT_EMPTY');
    expect(await w.db.prisma.placement.count()).toBe(2); // source 1 + target 1, nothing copied
    await A.clear(admin.h, PZ, date, { expectedVersion: 1 });
    const ok = await A.copy(admin.h, PZ, date, { expectedVersion: 2 });
    expect(ok.json()).toMatchObject({ copied: 1, skipped: [] });
  });

  it('sourceDate: same weekday only; a missing source occurrence copies nothing; no week-earlier default clash', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6, 2);
    const src = await w.db.prisma.occurrence.create({
      data: { eventId: PZ, date: new Date(addDays(date, -14)), startsAt: new Date(Date.now() + 86400e3) },
    });
    await A.put(src.id, a!.id, t1!.id, 3);
    expect((await A.copy(admin.h, PZ, date, { expectedVersion: 0 })).json()).toMatchObject({
      copied: 0,
      skipped: [],
    });
    const bad = await A.copy(admin.h, PZ, date, { expectedVersion: 0, sourceDate: addDays(date, -13) });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('INVALID_OCCURRENCE_DATE');
    expect((await A.copy(admin.h, PZ, date, { expectedVersion: 0, sourceDate: date })).statusCode).toBe(422);
    const r = await A.copy(admin.h, PZ, date, { expectedVersion: 0, sourceDate: addDays(date, -14) });
    expect(r.json()).toMatchObject({ copied: 1, sourceDate: addDays(date, -14) });
    expect(slots((await A.plan(admin.h, PZ, date)).json())).toEqual({ [a!.id]: [t1!.id, 3] });
  });
});
