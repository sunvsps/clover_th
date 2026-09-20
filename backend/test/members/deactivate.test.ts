import { describe, expect, it } from 'vitest';
import { BOT_KEY } from '../helpers/app.js';
import { loginAs } from '../helpers/auth.js';
import { useWorld } from '../helpers/world.js';
import { importMembers } from '../../src/modules/members/bulkImport.js';

const w = useWorld();
const K = { 'x-bot-key': BOT_KEY };

async function futureOccurrence(eventId = 'polarity-zone', hoursAhead = 48) {
  const ev = await w.db.prisma.scheduleEvent.findUniqueOrThrow({ where: { id: eventId } });
  const startsAt = new Date(Date.now() + hoursAhead * 3600e3);
  const date = new Date(startsAt.toISOString().slice(0, 10));
  return w.db.prisma.occurrence.create({ data: { eventId: ev.id, date, startsAt } });
}

describe('WP4 deactivation', () => {
  it('removes queue entries and sessions, keeps past records, and the member cannot log in', async () => {
    const m = await w.member('Leaver');
    const { cookie } = await loginAs(w.app, w.mock, m.discordId);
    await w.db.prisma.queueEntry.create({ data: { category: 'GEAR', memberId: m.id } });
    const past = await w.db.prisma.occurrence.create({
      data: {
        eventId: 'polarity-zone',
        date: new Date('2026-01-04'),
        startsAt: new Date('2026-01-04T05:00:00Z'),
      },
    });
    await w.db.prisma.registration.create({
      data: { occurrenceId: past.id, memberId: m.id, status: 'JOINED', registeredAt: new Date() },
    });

    const r = await w.app.inject({
      method: 'POST',
      url: `/api/v1/bot/members/${m.discordId}/deactivate`,
      headers: K,
    });
    expect(r.statusCode).toBe(200);
    expect(await w.db.prisma.queueEntry.count({ where: { memberId: m.id } })).toBe(0);
    expect(await w.db.prisma.session.count({ where: { memberId: m.id } })).toBe(0);
    expect(await w.db.prisma.registration.count({ where: { memberId: m.id } })).toBe(1); // history kept
    expect((await w.app.inject({ url: '/api/v1/me', headers: { cookie: cookie! } })).statusCode).toBe(401);
    const again = await loginAs(w.app, w.mock, m.discordId);
    expect(again.cookie).toBeNull();
    expect(again.cb.headers.location).toContain('authError=AUTH_MEMBER_INACTIVE');
  });

  it('removes future registrations and placements (bumping planVersion) and promotes the waitlist', async () => {
    const m = await w.member('Placed');
    const wait = await w.member('Waiting');
    const other = await w.member('Other');
    await w.db.prisma.activity.update({ where: { id: 'polarity-zone' }, data: { registrationCapacity: 1 } });
    const occ = await futureOccurrence();
    const team = await w.db.prisma.team.findFirstOrThrow({
      where: { room: { activityId: 'polarity-zone' } },
    });
    const t0 = Date.now();
    await w.db.prisma.registration.createMany({
      data: [
        { occurrenceId: occ.id, memberId: m.id, status: 'JOINED', registeredAt: new Date(t0) },
        { occurrenceId: occ.id, memberId: wait.id, status: 'WAITLISTED', registeredAt: new Date(t0 + 1000) },
        { occurrenceId: occ.id, memberId: other.id, status: 'WAITLISTED', registeredAt: new Date(t0 + 2000) },
      ],
    });
    await w.db.prisma.placement.create({
      data: { occurrenceId: occ.id, memberId: m.id, teamId: team.id, slot: 1 },
    });

    await w.app.inject({ method: 'POST', url: `/api/v1/bot/members/${m.discordId}/deactivate`, headers: K });
    expect(await w.db.prisma.placement.count()).toBe(0);
    expect((await w.db.prisma.occurrence.findUniqueOrThrow({ where: { id: occ.id } })).planVersion).toBe(1);
    const regs = await w.db.prisma.registration.findMany({
      where: { occurrenceId: occ.id },
      orderBy: { registeredAt: 'asc' },
    });
    expect(regs.map((x) => [x.memberId, x.status])).toEqual([
      [wait.id, 'JOINED'],
      [other.id, 'WAITLISTED'],
    ]);
    const actions = (await w.db.prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'member.deactivate',
        'placement.remove',
        'registration.remove',
        'registration.promote',
      ]),
    );
  });

  it('the bot deactivate call is idempotent', async () => {
    const m = await w.member('Twice');
    const url = `/api/v1/bot/members/${m.discordId}/deactivate`;
    expect((await w.app.inject({ method: 'POST', url, headers: K })).statusCode).toBe(200);
    const n = await w.db.prisma.auditLog.count();
    expect((await w.app.inject({ method: 'POST', url, headers: K })).statusCode).toBe(200);
    expect(await w.db.prisma.auditLog.count()).toBe(n);
  });

  it('admin deactivate works over HTTP and records the admin as actor', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('ByAdmin');
    const r = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${m.id}/deactivate`,
      headers: admin.h,
    });
    expect(r.json()).toMatchObject({ isActive: false });
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'member.deactivate' } });
    expect(log).toMatchObject({ actorType: 'MEMBER', actorId: admin.id });
  });
});

describe('WP4 audit log', () => {
  it('admins can read it with filters and cursor paging; newest first', async () => {
    const admin = await w.signIn({ admin: true });
    for (let i = 0; i < 5; i++) {
      await w.app.inject({
        method: 'PUT',
        url: `/api/v1/bot/members/4400${i}`,
        headers: K,
        payload: { ign: `Audit${i}`, job: 'Knight' },
      });
    }
    const page1 = (
      await w.app.inject({ url: '/api/v1/admin/audit-log?limit=3&action=member.create', headers: admin.h })
    ).json();
    expect(page1.items).toHaveLength(3);
    expect(page1.items[0].id).toBeGreaterThan(page1.items[1].id);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (
      await w.app.inject({
        url: `/api/v1/admin/audit-log?limit=3&action=member.create&cursor=${page1.nextCursor}`,
        headers: admin.h,
      })
    ).json();
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const none = (
      await w.app.inject({ url: '/api/v1/admin/audit-log?from=2999-01-01T00:00:00Z', headers: admin.h })
    ).json();
    expect(none.items).toHaveLength(0);
  });
});

describe('WP4 bulk import script logic', () => {
  it('imports rows like the bot, reports failures, is idempotent, and supports dry-run', async () => {
    const rows = [
      { discordId: '810001', ign: 'แมวกระเป๋า', job: 'ดรูอิด', nickname: 'แมว' },
      { discordId: '810002', ign: '-nara-', jobId: 3 },
      { discordId: '810003', ign: 'BadJob', job: 'Bard' },
      { discordId: '810004', ign: 'แมวกระเป๋า', job: 'Knight' }, // duplicate IGN
      { discordId: 'x', ign: 'Bad' },
    ];
    const dry = await importMembers(w.db.prisma, rows, { dryRun: true });
    // rows are rolled back one by one, so the IGN clash between rows 1 and 4 only shows in a real run
    expect(dry.map((r) => r.outcome)).toEqual(['created', 'created', 'failed', 'created', 'failed']);
    expect(await w.db.prisma.member.count()).toBe(0);

    const res = await importMembers(w.db.prisma, rows);
    expect(res.map((r) => r.outcome)).toEqual(['created', 'created', 'failed', 'failed', 'failed']);
    expect(res[3]!.error).toBe('DUPLICATE_IGN');
    expect(res[2]!.error).toBe('INVALID_JOB');
    expect(await w.db.prisma.member.count()).toBe(2);
    expect((await importMembers(w.db.prisma, rows.slice(0, 2))).map((r) => r.outcome)).toEqual([
      'unchanged',
      'unchanged',
    ]);
    expect(
      (await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'member.create' } })).actorType,
    ).toBe('SYSTEM');
  });
});
