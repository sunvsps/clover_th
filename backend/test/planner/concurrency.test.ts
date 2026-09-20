import { describe, expect, it } from 'vitest';
import { withActivityLock } from '../../src/lib/locks.js';
import { getOrCreateOccurrence } from '../../src/lib/occurrence.js';
import { placeMember } from '../../src/modules/planner/plan.js';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';
import { api } from './helpers.js';

const w = useWorld();
const A = api(w);
type L = {
  rooms: { id: number; key: string; name: string; teams: { id: number; name: string; size: number }[] }[];
};
/** Layout GET output -> PUT body (strips computed fields). */
const roomBody = (r: L['rooms'][number], teams = r.teams) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  teams: teams.map((t) => ({ id: t.id, name: t.name, size: t.size })),
});
const PZ = 'polarity-zone';

describe('WP7a concurrency (Promise.all against real Postgres)', () => {
  it('parallel moves into the last free slot: exactly one wins, the rest TEAM_FULL (no version check involved)', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await A.members(10);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    const o = await w.db.prisma.occurrence.create({
      data: { eventId: PZ, date: new Date(date), startsAt: new Date(Date.now() + 5 * 86400e3) },
    });
    for (let i = 0; i < 4; i++) await A.put(o.id, ms[i]!.id, t1!.id, i + 1);
    // the same steps as the route, minus the optimistic version check, so only the lock protects the last slot
    const results = await Promise.allSettled(
      ms.slice(4).map((m) =>
        w.app.tx(async (tx) => {
          await withActivityLock(tx, 'polarity-zone');
          const occ = await getOrCreateOccurrence(tx, PZ, date);
          return placeMember(tx, { occ, memberId: m.id, teamId: t1!.id, actor: { memberId: admin.id } });
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(5);
    expect(failed.every((f) => f.reason.code === 'TEAM_FULL')).toBe(true);
    expect(await w.db.prisma.placement.count({ where: { teamId: t1!.id } })).toBe(5);
    expect((await A.occ(PZ, date)).planVersion).toBe(1);
  });

  it('parallel moves via HTTP with the same expectedVersion: exactly one 200, the rest PLAN_VERSION_CONFLICT', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await A.members(12);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    const rs = await Promise.all(
      ms.map((m) => A.place(admin.h, PZ, date, m.id, { teamId: t1!.id, expectedVersion: 0 })),
    );
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const losers = rs.filter((r) => r.statusCode !== 200);
    expect(losers).toHaveLength(11);
    expect(losers.every((r) => r.statusCode === 409 && r.json().error.code === 'PLAN_VERSION_CONFLICT')).toBe(
      true,
    );
    expect(await w.db.prisma.placement.count()).toBe(1);
    expect((await A.plan(admin.h, PZ, date)).json().version).toBe(1);
  });

  it('two members dropped on the same empty slot concurrently: one takes it, the other swaps or is refused, never two in a slot', async () => {
    const admin = await w.signIn({ admin: true });
    const ms = await A.members(6);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6);
    const o = await w.db.prisma.occurrence.create({
      data: { eventId: PZ, date: new Date(date), startsAt: new Date(Date.now() + 5 * 86400e3) },
    });
    await Promise.all(
      ms.map((m) =>
        w.app.tx(async (tx) => {
          await withActivityLock(tx, PZ);
          const occ = await getOrCreateOccurrence(tx, PZ, date);
          return placeMember(tx, {
            occ,
            memberId: m.id,
            teamId: t1!.id,
            slot: 3,
            actor: { memberId: admin.id },
          });
        }),
      ),
    );
    const rows = await w.db.prisma.placement.findMany({ where: { occurrenceId: o.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slot).toBe(3);
  });

  it('a layout shrink racing a placement (occurrence not yet existing) never leaves a placement in an oversized or removed team', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await A.members(1);
    let sawPlacementWin = false;
    let sawLayoutWin = false;
    for (let round = 1; round <= 8; round++) {
      const date = futureDate(6, round);
      const cur = (await A.layout(admin.h, PZ)).json() as {
        rooms: {
          id: number;
          key: string;
          name: string;
          teams: { id: number; name: string; size: number }[];
        }[];
      };
      const room = cur.rooms[0]!;
      const target = room.teams[0]!;
      const shrunk = [
        roomBody(
          room,
          room.teams.map((t) => (t.id === target.id ? { ...t, size: 2 } : t)),
        ),
      ];
      const [pl, ly] = await Promise.all([
        A.place(admin.h, PZ, date, m!.id, { teamId: target.id, slot: 5, expectedVersion: 0 }),
        A.putLayout(admin.h, PZ, shrunk),
      ]);
      // exactly one order happened
      if (pl.statusCode === 200) {
        sawPlacementWin = true;
        expect(ly.statusCode, ly.body).toBe(409);
        expect(ly.json().error.code).toBe('LAYOUT_BELOW_PLACED');
      } else {
        sawLayoutWin = true;
        expect(pl.statusCode).toBe(422);
        expect(pl.json().error.code).toBe('SLOT_OUT_OF_RANGE');
        expect(ly.statusCode).toBe(200);
      }
      const bad = await w.db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Placement" p
        JOIN "Team" t ON t.id = p."teamId"
        JOIN "Occurrence" o ON o.id = p."occurrenceId"
        WHERE o."startsAt" > clock_timestamp() AND (p.slot > t.size OR t."archivedAt" IS NOT NULL)`;
      expect(bad[0]!.n).toBe(0);
      // restore for the next round
      await w.db.prisma.team.update({ where: { id: target.id }, data: { size: 5 } });
      await w.db.prisma.placement.deleteMany();
    }
    expect(sawPlacementWin || sawLayoutWin).toBe(true);
  });

  it('a team removal racing a placement into it: either the removal is refused or the placement is, never a placement in a removed team', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await A.members(1);
    for (let round = 1; round <= 6; round++) {
      const date = futureDate(6, round);
      const cur = (await A.layout(admin.h, PZ)).json() as {
        rooms: {
          id: number;
          key: string;
          name: string;
          teams: { id: number; name: string; size: number }[];
        }[];
      };
      const room = cur.rooms[0]!;
      const victim = room.teams[room.teams.length - 1]!;
      const without = [
        roomBody(
          room,
          room.teams.filter((t) => t.id !== victim.id),
        ),
      ];
      const [pl, ly] = await Promise.all([
        A.place(admin.h, PZ, date, m!.id, { teamId: victim.id, expectedVersion: 0 }),
        A.putLayout(admin.h, PZ, without),
      ]);
      expect([pl.statusCode === 200, ly.statusCode === 200]).not.toEqual([true, true]);
      const bad = await w.db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Placement" p JOIN "Team" t ON t.id = p."teamId"
        WHERE t."archivedAt" IS NOT NULL`;
      expect(bad[0]!.n).toBe(0);
      // put the team back (a fresh one) for the next round
      await w.db.prisma.placement.deleteMany();
      const now = (await A.layout(admin.h, PZ)).json() as {
        rooms: {
          id: number;
          key: string;
          name: string;
          teams: { id: number; name: string; size: number }[];
        }[];
      };
      if (now.rooms[0]!.teams.length < 10) {
        await A.putLayout(admin.h, PZ, [
          { ...now.rooms[0]!, teams: [...now.rooms[0]!.teams, { name: 'Restored', size: 5 }] },
        ]);
      }
    }
  });

  it('concurrent registration writes and planner writes on one activity serialize (lock held blocks a placement)', async () => {
    const admin = await w.signIn({ admin: true });
    const [m] = await A.members(1);
    const [t1] = await A.teams(PZ);
    const date = futureDate(6, 2);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = w.app.tx(async (tx) => {
      await withActivityLock(tx, PZ);
      locked();
      await gate;
    });
    await isLocked;
    let done = false;
    const p = A.place(admin.h, PZ, date, m!.id, { teamId: t1!.id, expectedVersion: 0 }).then(
      (r) => ((done = true), r),
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false);
    expect(await w.db.prisma.occurrence.count()).toBe(0);
    release();
    await holder;
    expect((await p).statusCode).toBe(200);
  });
});
