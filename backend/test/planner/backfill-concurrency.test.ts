import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api } from './helpers.js';
import { makeScene } from './scene.js';

const w = useWorld({ env: { NOTIFICATIONS_PROVIDER: 'fake' } });
const A = api(w);
const scene = makeScene(w, A);
const PZ = 'polarity-zone';
type H = Record<string, string>;

const reg = (h: H, date: string, memberId: string, status: string, event = PZ) =>
  w.app.inject({
    method: 'PUT',
    url: `/api/v1/events/${event}/occurrences/${date}/registrations/${memberId}`,
    headers: h,
    payload: { status },
  });

/** Global invariants after any concurrent mix: one slot per member, no placed member on LEAVE that we removed, one message per promotion. */
async function invariants(occurrenceId: number) {
  const dup = await w.db.prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (SELECT "memberId" FROM "Placement" WHERE "occurrenceId" = ${occurrenceId}
      GROUP BY "memberId" HAVING count(*) > 1) x`;
  expect(dup[0]!.n).toBe(0);
  const backfills = await w.db.prisma.placement.count({ where: { occurrenceId, source: 'AUTO_BACKFILL' } });
  const audits = await w.db.prisma.auditLog.count({
    where: { action: 'plan.backfill', entityId: String(occurrenceId) },
  });
  return { backfills, audits };
}

describe('WP7b backfill concurrency (Promise.all against real Postgres)', () => {
  it('two simultaneous withdrawals with ONE reserve promote that reserve exactly once; the other slot stays empty', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 2, reserves: 1 });
    const rs = await Promise.all(s.placed.map((m) => reg(admin.h, s.date, m.id, 'LEAVE')));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.flatMap((r) => r.json().backfilled)).toHaveLength(1);
    expect(await w.db.prisma.placement.count({ where: { occurrenceId: s.occ.id } })).toBe(1);
    const p = await w.db.prisma.placement.findFirstOrThrow({ where: { occurrenceId: s.occ.id } });
    expect(p.memberId).toBe(s.reserves[0]!.id);
    expect(await invariants(s.occ.id)).toEqual({ backfills: 1, audits: 1 });
    expect(await w.db.prisma.notificationOutbox.count()).toBe(1);
  });

  it('several simultaneous withdrawals and several reserves: every vacated slot is filled once, in registration order, each reserve at most once', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 8, reserves: 5 });
    const leaving = s.placed.slice(0, 5);
    const rs = await Promise.all(leaving.map((m, i) => reg(admin.h, s.date, m.id, i % 2 ? 'NONE' : 'LEAVE')));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const bf = rs.flatMap((r) => r.json().backfilled) as {
      promotedMemberId: string;
      slot: number;
      teamId: number;
      vacatedMemberId: string;
    }[];
    expect(bf).toHaveLength(5);
    expect(new Set(bf.map((b) => b.promotedMemberId)).size).toBe(5); // no reserve twice
    // each vacated slot filled by exactly one reserve, in the exact slot
    for (const b of bf) {
      const holder = await w.db.prisma.placement.findFirstOrThrow({
        where: { occurrenceId: s.occ.id, teamId: b.teamId, slot: b.slot },
      });
      expect(holder.memberId).toBe(b.promotedMemberId);
      expect(holder.backfilledForMemberId).toBe(b.vacatedMemberId);
    }
    // reserves are consumed strictly in registration order (R1..R5) across the serialized withdrawals
    const promotedOrder = (
      await w.db.prisma.auditLog.findMany({ where: { action: 'plan.backfill' }, orderBy: { id: 'asc' } })
    ).map((a) => (a.meta as { promotedMemberId: string }).promotedMemberId);
    expect(promotedOrder).toEqual(s.reserves.map((r) => r.id));
    expect(await invariants(s.occ.id)).toEqual({ backfills: 5, audits: 5 });
    expect((await A.occ(PZ, s.date)).planVersion).toBe(5);
  });

  it('withdrawals of more members than reserves: extra slots stay empty, still exactly one promotion per reserve', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 6, reserves: 2 });
    await Promise.all(s.placed.slice(0, 5).map((m) => reg(admin.h, s.date, m.id, 'LEAVE')));
    expect(
      await w.db.prisma.placement.count({ where: { occurrenceId: s.occ.id, source: 'AUTO_BACKFILL' } }),
    ).toBe(2);
    expect(await w.db.prisma.placement.count({ where: { occurrenceId: s.occ.id } })).toBe(3); // 1 original + 2 promoted
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.vacated' } })).toBe(3);
  });

  it('the SAME withdrawal fired 10 times at once (client retries) promotes exactly one reserve', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 3 });
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reg(admin.h, s.date, s.placed[0]!.id, i % 2 ? 'LEAVE' : 'NONE')),
    );
    // the first one wins; whether the rest are no-ops depends on status, but no second promotion may happen
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.flatMap((r) => r.json().backfilled)).toHaveLength(1);
    expect(await invariants(s.occ.id)).toEqual({ backfills: 1, audits: 1 });
    expect(await w.db.prisma.notificationOutbox.count()).toBe(1);
    expect((await A.occ(PZ, s.date)).planVersion).toBe(1);
  });

  it('the reserve withdrawing at the same moment as the placed member: consistent either way, never a placed member on leave', async () => {
    const admin = await w.signIn({ admin: true });
    for (let round = 0; round < 6; round++) {
      await w.db.prisma
        .$executeRaw`TRUNCATE "NotificationOutbox", "AuditLog", "Placement", "Registration", "Occurrence" RESTART IDENTITY CASCADE`;
      const s = await scene({ placed: 1, reserves: 3, tag: `r${round}` });
      const [r1, r2, r3] = s.reserves;
      const [a, b] = await Promise.all([
        reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE'),
        reg(admin.h, s.date, r1!.id, round % 2 ? 'NONE' : 'LEAVE'),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      // whichever order: slot 1 is held by R2 (R1 either left first, or was promoted and then left and R2 took over)
      const holder = await w.db.prisma.placement.findMany({ where: { occurrenceId: s.occ.id } });
      expect(holder.map((h) => [h.memberId, h.slot])).toEqual([[r2!.id, 1]]);
      const placedOnLeave = await w.db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Placement" p JOIN "Registration" r ON r."occurrenceId" = p."occurrenceId" AND r."memberId" = p."memberId"
        WHERE r.status <> 'JOINED'`;
      expect(placedOnLeave[0]!.n).toBe(0);
      const plan = (await A.plan(admin.h, PZ, s.date)).json();
      expect(plan.reserves.map((x: { memberId: string }) => x.memberId)).toEqual([r3!.id]);
      await invariants(s.occ.id);
    }
  });

  it('waitlist + capacity + backfill under concurrency: exactly the seats freed are re-filled, ordering respected', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { registrationCapacity: 6 } });
    const s = await scene({ placed: 2, reserves: 4 }); // 6 JOINED = capacity
    const waiters = await A.members(3, 'Wl');
    for (const [i, m] of waiters.entries()) {
      await w.db.prisma.registration.create({
        data: {
          occurrenceId: s.occ.id,
          memberId: m.id,
          status: 'WAITLISTED',
          registeredAt: new Date(Date.now() - 1000 + i),
        },
      });
    }
    // two placed members and one reserve withdraw at once
    const rs = await Promise.all([
      reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE'),
      reg(admin.h, s.date, s.placed[1]!.id, 'NONE'),
      reg(admin.h, s.date, s.reserves[3]!.id, 'NONE'),
    ]);
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const promoted = rs.flatMap((r) => r.json().promoted);
    expect(promoted.sort()).toEqual(waiters.map((m) => m.id).sort()); // 3 seats freed -> all 3 waiters in, once each
    expect(new Set(promoted).size).toBe(3);
    const counts = await w.db.prisma.registration.groupBy({
      by: ['status'],
      where: { occurrenceId: s.occ.id },
      _count: true,
    });
    expect(Object.fromEntries(counts.map((c) => [c.status, c._count]))).toMatchObject({
      JOINED: 6,
      LEAVE: 1,
    });
    // the two slots were filled by the two EARLIEST reserves, not by the newly promoted waiters
    const filled = await w.db.prisma.placement.findMany({
      where: { occurrenceId: s.occ.id, source: 'AUTO_BACKFILL' },
      orderBy: { slot: 'asc' },
    });
    expect(filled.map((f) => f.memberId).sort()).toEqual([s.reserves[0]!.id, s.reserves[1]!.id].sort());
    expect(await invariants(s.occ.id)).toEqual({ backfills: 2, audits: 2 });
  });

  it('a withdrawal racing the autoBackfill switch sees the setting consistently (Activity lock)', async () => {
    const admin = await w.signIn({ admin: true });
    for (let round = 0; round < 6; round++) {
      await w.db.prisma
        .$executeRaw`TRUNCATE "NotificationOutbox", "AuditLog", "Placement", "Registration", "Occurrence" RESTART IDENTITY CASCADE`;
      await w.db.prisma.activity.update({ where: { id: PZ }, data: { autoBackfill: false } });
      const s = await scene({ placed: 1, reserves: 1, tag: `s${round}` });
      const [wd, patch] = await Promise.all([
        reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE'),
        w.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/activities/${PZ}`,
          headers: admin.h,
          payload: { autoBackfill: true },
        }),
      ]);
      expect(wd.statusCode).toBe(200);
      expect(patch.statusCode).toBe(200);
      const placements = await w.db.prisma.placement.findMany({ where: { occurrenceId: s.occ.id } });
      if (wd.json().backfilled.length === 0) {
        // withdrawal ran first (setting was OFF): placement kept, nobody promoted
        expect(placements.map((p) => p.memberId)).toEqual([s.placed[0]!.id]);
      } else {
        // switch ran first: removed and backfilled
        expect(placements.map((p) => p.memberId)).toEqual([s.reserves[0]!.id]);
      }
    }
  });

  it('a withdrawal racing a layout shrink serializes: no placement is left in an oversized slot, backfill targets a valid slot', async () => {
    const admin = await w.signIn({ admin: true });
    for (let round = 0; round < 6; round++) {
      await w.db.prisma
        .$executeRaw`TRUNCATE "NotificationOutbox", "AuditLog", "Placement", "Registration", "Occurrence" RESTART IDENTITY CASCADE`;
      await w.db.prisma.team.updateMany({ where: { room: { activityId: PZ } }, data: { size: 5 } });
      const s = await scene({ placed: 5, reserves: 1, tag: `l${round}` }); // team 1 full: slots 1-5
      const layout = (await A.layout(admin.h, PZ)).json() as {
        rooms: {
          id: number;
          key: string;
          name: string;
          teams: { id: number; name: string; size: number }[];
        }[];
      };
      const room = layout.rooms[0]!;
      const body = [
        {
          id: room.id,
          key: room.key,
          name: room.name,
          teams: room.teams.map((t) => ({
            id: t.id,
            name: t.name,
            size: t.id === s.teams[0]!.id ? 4 : t.size,
          })),
        },
      ];
      const [wd, ly] = await Promise.all([
        reg(admin.h, s.date, s.placed[4]!.id, 'LEAVE'), // vacates slot 5 of the team being shrunk
        A.putLayout(admin.h, PZ, body),
      ]);
      expect(wd.statusCode).toBe(200);
      expect([200, 409]).toContain(ly.statusCode);
      const bad = await w.db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Placement" p JOIN "Team" t ON t.id = p."teamId" WHERE p.slot > t.size`;
      if (ly.statusCode === 200) expect(bad[0]!.n).toBe(0);
      else expect(ly.json().error.code).toBe('LAYOUT_BELOW_PLACED');
    }
  });
});
