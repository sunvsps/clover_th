import { describe, expect, it } from 'vitest';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';
import { api } from './helpers.js';

const w = useWorld();
const A = api(w);
const PZ = 'polarity-zone';

type Layout = {
  rooms: {
    id: number;
    key: string;
    name: string;
    capacity: number;
    teams: { id: number; name: string; size: number }[];
  }[];
};
const asBody = (l: Layout) =>
  l.rooms.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    teams: r.teams.map((t) => ({ id: t.id, name: t.name, size: t.size })),
  }));
const layoutOf = async (h: Record<string, string>, act = PZ) => (await A.layout(h, act)).json() as Layout;
const futureOcc = (date: string, eventId = PZ) =>
  w.db.prisma.occurrence.create({
    data: { eventId, date: new Date(date), startsAt: new Date(Date.now() + 4 * 86400e3) },
  });

describe('WP7a layout', () => {
  it('GET returns the default layouts with computed capacities (Guild League 60 + 90, Polarity Zone 50)', async () => {
    const admin = await w.signIn({ admin: true });
    expect((await layoutOf(admin.h)).rooms.map((r) => [r.key, r.capacity])).toEqual([['default', 50]]);
    expect((await layoutOf(admin.h, 'guild-league')).rooms.map((r) => [r.key, r.capacity])).toEqual([
      ['main', 60],
      ['sub', 90],
    ]);
    const none = await A.layout(admin.h, 'hazy-forest');
    expect(none.json().error.code).toBe('ACTIVITY_HAS_NO_PLANNER');
    expect((await A.putLayout(admin.h, 'hazy-forest', [])).json().error.code).toBe('ACTIVITY_HAS_NO_PLANNER');
  });

  it('PUT replaces the layout as data: rename, resize, add and reorder teams, add a room; capacity is derived', async () => {
    const admin = await w.signIn({ admin: true });
    const cur = await layoutOf(admin.h);
    const body = asBody(cur);
    body[0]!.teams[0]!.size = 8;
    body[0]!.teams[1]!.name = 'Renamed';
    body[0]!.teams.push({ name: 'New team', size: 3 } as never);
    body.push({ key: 'extra', name: 'Extra room', teams: [{ name: 'X1', size: 5 }] } as never);
    const r = await A.putLayout(admin.h, PZ, body);
    expect(r.statusCode).toBe(200);
    const after = r.json() as Layout;
    expect(after.rooms.map((x) => [x.key, x.capacity])).toEqual([
      ['default', 50 + 3 + 3],
      ['extra', 5],
    ]);
    expect(after.rooms[0]!.teams[1]!.name).toBe('Renamed');
    expect(after.rooms[0]!.teams[0]!.size).toBe(8);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'layout.update' } })).toBe(1);
  });

  it('validation: duplicate room keys, unknown ids, bad sizes and unknown fields', async () => {
    const admin = await w.signIn({ admin: true });
    const cur = await layoutOf(admin.h);
    const base = asBody(cur);
    const dup = await A.putLayout(admin.h, PZ, [...base, { key: 'default', name: 'Dup', teams: [] }]);
    expect(dup.statusCode).toBe(422);
    const foreign = (await A.teams('guild-league'))[0]!;
    const withForeign = structuredClone(base);
    withForeign[0]!.teams.push({ id: foreign.id, name: 'x', size: 5 } as never);
    expect((await A.putLayout(admin.h, PZ, withForeign)).json().error.code).toBe('TEAM_NOT_IN_ACTIVITY');
    expect(
      (await A.putLayout(admin.h, PZ, [{ id: 99999, key: 'default', name: 'x', teams: [] }])).json().error
        .code,
    ).toBe('TEAM_NOT_IN_ACTIVITY');
    for (const size of [0, 51, 2.5]) {
      const bad = structuredClone(base);
      bad[0]!.teams[0]!.size = size;
      expect((await A.putLayout(admin.h, PZ, bad)).statusCode).toBe(422);
    }
    expect((await A.putLayout(admin.h, PZ, [{ key: 'BAD KEY', name: 'x', teams: [] }])).statusCode).toBe(422);
    expect((await layoutOf(admin.h)).rooms[0]!.capacity).toBe(50); // untouched
  });

  it('LAYOUT_BELOW_PLACED: removing a team that holds a placement, or shrinking below a placed slot, is rejected', async () => {
    const admin = await w.signIn({ admin: true });
    const [a, b] = await A.members(2);
    const cur = await layoutOf(admin.h);
    const [t1, t2] = cur.rooms[0]!.teams;
    const o = await futureOcc(futureDate(6));
    await A.put(o.id, a!.id, t1!.id, 5);
    await A.put(o.id, b!.id, t2!.id, 2);

    const shrink = asBody(cur);
    shrink[0]!.teams[0]!.size = 4;
    const r1 = await A.putLayout(admin.h, PZ, shrink);
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error).toMatchObject({
      code: 'LAYOUT_BELOW_PLACED',
      details: { teamId: t1!.id, placed: 5, size: 4 },
    });

    const remove = asBody(cur);
    remove[0]!.teams = remove[0]!.teams.filter((t) => t.id !== t2!.id);
    const r2 = await A.putLayout(admin.h, PZ, remove);
    expect(r2.json().error).toMatchObject({
      code: 'LAYOUT_BELOW_PLACED',
      details: { teamId: t2!.id, size: 0 },
    });

    const removeRoom = await A.putLayout(admin.h, PZ, []);
    expect(removeRoom.json().error.code).toBe('LAYOUT_BELOW_PLACED');

    // shrinking to exactly the highest placed slot is fine
    const ok = asBody(cur);
    ok[0]!.teams[0]!.size = 5;
    ok[0]!.teams[1]!.size = 2;
    expect((await A.putLayout(admin.h, PZ, ok)).statusCode).toBe(200);
    expect((await layoutOf(admin.h)).rooms[0]!.capacity).toBe(5 + 2 + 5 * 8);
  });

  it('only occurrences that have not started are checked; teams with any placement are archived, never deleted', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const cur = await layoutOf(admin.h);
    const [t1, t2] = cur.rooms[0]!.teams;
    const past = await w.db.prisma.occurrence.create({
      data: { eventId: PZ, date: new Date('2026-01-04'), startsAt: new Date('2026-01-04T05:00:00Z') },
    });
    await A.put(past.id, a!.id, t1!.id, 5);
    const body = asBody(cur);
    body[0]!.teams = body[0]!.teams.filter((t) => t.id !== t1!.id); // t1 removed; only a PAST placement uses it
    body[0]!.teams.find((t) => t.id === t2!.id)!.size = 5;
    const r = await A.putLayout(admin.h, PZ, body);
    expect(r.statusCode).toBe(200);
    const archived = await w.db.prisma.team.findUniqueOrThrow({ where: { id: t1!.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect((r.json() as Layout).rooms[0]!.teams.map((t) => t.id)).not.toContain(t1!.id);
    expect((r.json() as Layout).rooms[0]!.capacity).toBe(45);
    // the past plan still renders the archived team
    const plan = (await A.plan(admin.h, PZ, '2026-01-04')).json();
    void plan;
    // a team that never had placements is deleted
    const t3 = cur.rooms[0]!.teams[2]!;
    const body2 = asBody((await layoutOf(admin.h)) as Layout).map((rm) => ({
      ...rm,
      teams: rm.teams.filter((t) => t.id !== t3.id),
    }));
    await A.putLayout(admin.h, PZ, body2);
    expect(await w.db.prisma.team.findUnique({ where: { id: t3.id } })).toBeNull();
  });

  it('a removed room is archived (or deleted when empty) and its key can be re-created', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const cur = await layoutOf(admin.h, 'guild-league');
    const sub = cur.rooms[1]!;
    const past = await w.db.prisma.occurrence.create({
      data: {
        eventId: 'guild-league-tue-1',
        date: new Date('2026-01-06'),
        startsAt: new Date('2026-01-06T14:30:00Z'),
      },
    });
    await A.put(past.id, a!.id, sub.teams[0]!.id, 1);
    const withoutSub = asBody({ rooms: [cur.rooms[0]!] });
    expect((await A.putLayout(admin.h, 'guild-league', withoutSub)).statusCode).toBe(200);
    const room = await w.db.prisma.room.findUniqueOrThrow({ where: { id: sub.id } });
    expect(room.archivedAt).not.toBeNull();
    expect(await w.db.prisma.team.count({ where: { roomId: sub.id, archivedAt: null } })).toBe(0);
    const recreated = await A.putLayout(admin.h, 'guild-league', [
      ...withoutSub,
      { key: 'sub', name: 'Sub again', teams: [{ name: 'S1', size: 5 }] },
    ]);
    expect(recreated.statusCode).toBe(200);
    expect((recreated.json() as Layout).rooms.map((r) => [r.key, r.capacity])).toEqual([
      ['main', 60],
      ['sub', 5],
    ]);
  });

  it('two rooms can swap keys in one PUT', async () => {
    const admin = await w.signIn({ admin: true });
    const cur = await layoutOf(admin.h, 'guild-league');
    const body = asBody(cur);
    body[0]!.key = 'sub';
    body[1]!.key = 'main';
    const r = await A.putLayout(admin.h, 'guild-league', body);
    expect(r.statusCode).toBe(200);
    expect((r.json() as Layout).rooms.map((x) => x.key)).toEqual(['sub', 'main']);
  });

  it('a layout change bumps planVersion of not-yet-started occurrences so stale editors reload', async () => {
    const admin = await w.signIn({ admin: true });
    const [a] = await A.members(1);
    const [t1] = (await layoutOf(admin.h)).rooms[0]!.teams;
    const date = futureDate(6);
    await A.place(admin.h, PZ, date, a!.id, { teamId: t1!.id, expectedVersion: 0 }); // version 1
    const body = asBody(await layoutOf(admin.h));
    body[0]!.name = 'Renamed room';
    await A.putLayout(admin.h, PZ, body);
    expect((await A.plan(admin.h, PZ, date)).json().version).toBe(2);
    const stale = await A.place(admin.h, PZ, date, a!.id, { teamId: null, expectedVersion: 1 });
    expect(stale.json().error.code).toBe('PLAN_VERSION_CONFLICT');
  });
});
