import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IGN_INDEX } from '../../src/lib/errors.js';
import { isUniqueViolation } from '../../src/lib/pgErrors.js';
import { createTestDb, truncateAll, type TestDb } from '../helpers/db.js';

let db: TestDb;
let p: TestDb['prisma'];
let seq = 0;

beforeAll(async () => {
  db = await createTestDb();
  p = db.prisma;
});
afterAll(() => db.drop());
beforeEach(async () => {
  await truncateAll(p);
  await p.job.createMany({
    data: [
      { id: 1, label: 'Knight', color: '#fff' },
      { id: 2, label: 'Wizard', color: '#000' },
    ],
  });
});

const member = (ign: string, extra: Partial<Prisma.MemberUncheckedCreateInput> = {}) =>
  p.member.create({ data: { discordId: String(1000000 + ++seq), ign, jobId: 1, ...extra } });

async function planner() {
  await p.activity.create({ data: { id: 'act', name: 'Act', hasPlanner: true } });
  await p.scheduleEvent.create({
    data: { id: 'ev', activityId: 'act', dayOfWeek: 0, startTime: '21:00', endTime: '22:00' },
  });
  const room = await p.room.create({ data: { activityId: 'act', key: 'main', name: 'Main' } });
  const team = await p.team.create({ data: { roomId: room.id, name: 'T1' } });
  const team2 = await p.team.create({ data: { roomId: room.id, name: 'T2' } });
  const occ = await p.occurrence.create({
    data: { eventId: 'ev', date: new Date('2026-09-21'), startsAt: new Date('2026-09-21T14:00:00Z') },
  });
  return { room, team, team2, occ };
}

describe('IGN uniqueness (FR-1.10)', () => {
  it('two active members cannot share an IGN, case-insensitively', async () => {
    await member('Nara');
    const err = await member('nARA').catch((e) => e);
    expect(isUniqueViolation(err, ...IGN_INDEX)).toBe(true);
  });

  it('is NFC-insensitive (precomposed vs combining marks)', async () => {
    await member('café');
    const err = await member('café').catch((e) => e);
    expect(isUniqueViolation(err, ...IGN_INDEX)).toBe(true);
  });

  it('applies to Thai roster names too', async () => {
    await member('แมวกระเป๋า');
    const err = await member('แมวกระเป๋า').catch((e) => e);
    expect(isUniqueViolation(err, ...IGN_INDEX)).toBe(true);
    await member('-nara-');
    await member('เสีEวค่ะXลวงMา');
  });

  it('a deactivated member IGN can be reused', async () => {
    const old = await member('Reuse');
    await p.member.update({ where: { id: old.id }, data: { isActive: false } });
    await expect(member('reuse')).resolves.toBeTruthy();
  });

  it('reactivating a deactivated member whose IGN was taken fails (DUPLICATE_IGN source)', async () => {
    const old = await member('Taken', { isActive: false });
    await member('Taken');
    const err = await p.member.update({ where: { id: old.id }, data: { isActive: true } }).catch((e) => e);
    expect(isUniqueViolation(err, ...IGN_INDEX)).toBe(true);
    const rawErr =
      await p.$executeRaw`UPDATE "Member" SET "isActive" = true WHERE id = ${old.id}::uuid`.catch((e) => e);
    expect(isUniqueViolation(rawErr, ...IGN_INDEX)).toBe(true);
  });
});

describe('auction constraints', () => {
  const round = (
    type: 'LIVE_CLAIM' | 'QUEUE_RANKED',
    status: 'OPEN' | 'DRAFT' | 'CLOSED',
    createdById: string,
    winCap?: number | null,
  ) =>
    p.auctionRound.create({
      data: {
        type,
        status,
        name: 'r',
        createdById,
        winCap: winCap === undefined ? (type === 'LIVE_CLAIM' ? 5 : null) : winCap,
      },
    });

  it('a second OPEN round of the same type is rejected; other type or non-OPEN is fine', async () => {
    const m = await member('Admin');
    await round('LIVE_CLAIM', 'OPEN', m.id);
    await expect(round('LIVE_CLAIM', 'OPEN', m.id)).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: ['type'] },
    });
    await expect(round('QUEUE_RANKED', 'OPEN', m.id)).resolves.toBeTruthy();
    await expect(round('LIVE_CLAIM', 'DRAFT', m.id)).resolves.toBeTruthy();
    await expect(round('LIVE_CLAIM', 'CLOSED', m.id)).resolves.toBeTruthy();
  });

  it('a QUEUE_RANKED round with winCap set is rejected (and LIVE_CLAIM needs one)', async () => {
    const m = await member('Admin');
    await expect(round('QUEUE_RANKED', 'DRAFT', m.id, 3)).rejects.toThrow(/round_wincap_only_live_claim/);
    await expect(round('LIVE_CLAIM', 'DRAFT', m.id, null)).rejects.toThrow(/round_wincap_only_live_claim/);
  });

  it('winnerId without wonAt is rejected (and vice versa)', async () => {
    const m = await member('Admin');
    const r = await round('LIVE_CLAIM', 'DRAFT', m.id);
    const item = await p.auctionItem.create({ data: { roundId: r.id, name: 'i', category: 'GEAR' } });
    await expect(p.auctionItem.update({ where: { id: item.id }, data: { winnerId: m.id } })).rejects.toThrow(
      /item_winner_matches_wonat/,
    );
    await expect(
      p.auctionItem.update({ where: { id: item.id }, data: { wonAt: new Date() } }),
    ).rejects.toThrow(/item_winner_matches_wonat/);
    await expect(
      p.auctionItem.update({ where: { id: item.id }, data: { winnerId: m.id, wonAt: new Date() } }),
    ).resolves.toBeTruthy();
  });

  it('deleting a round cascades to items, preferences, cutoffs and snapshots', async () => {
    const m = await member('Admin');
    const r = await round('QUEUE_RANKED', 'DRAFT', m.id);
    const item = await p.auctionItem.create({ data: { roundId: r.id, name: 'i', category: 'GEAR' } });
    await p.preference.create({ data: { roundId: r.id, memberId: m.id, itemId: item.id, rank: 1 } });
    await p.roundQueueCutoff.create({ data: { roundId: r.id, category: 'GEAR', cutoffId: 1 } });
    await p.roundQueueSnapshot.create({
      data: { roundId: r.id, category: 'GEAR', memberId: m.id, position: 1 },
    });
    await p.auctionRound.delete({ where: { id: r.id } });
    expect(await p.auctionItem.count()).toBe(0);
    expect(await p.preference.count()).toBe(0);
    expect(await p.roundQueueCutoff.count()).toBe(0);
    expect(await p.roundQueueSnapshot.count()).toBe(0);
  });
});

describe('activity / room / job constraints', () => {
  it('autoBackfill=true with hasPlanner=false is rejected', async () => {
    await expect(
      p.activity.create({ data: { id: 'bad', name: 'Bad', hasPlanner: false, autoBackfill: true } }),
    ).rejects.toThrow(/activity_backfill_requires_planner/);
    await expect(
      p.activity.create({ data: { id: 'ok', name: 'Ok', hasPlanner: true, autoBackfill: true } }),
    ).resolves.toBeTruthy();
  });

  it('a job in use cannot be deleted; an unused one can', async () => {
    await member('InUse');
    const err = await p.job.delete({ where: { id: 1 } }).catch((e) => e);
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err.code).toBe('P2003');
    await expect(p.job.delete({ where: { id: 2 } })).resolves.toBeTruthy();
  });

  it('a room key can be re-created after its room is archived, but not while live', async () => {
    await p.activity.create({ data: { id: 'a', name: 'A' } });
    const r1 = await p.room.create({ data: { activityId: 'a', key: 'main', name: 'Main' } });
    await expect(
      p.room.create({ data: { activityId: 'a', key: 'main', name: 'Dup' } }),
    ).rejects.toMatchObject({ code: 'P2002', meta: { target: ['activityId', 'key'] } });
    await p.room.update({ where: { id: r1.id }, data: { archivedAt: new Date() } });
    await expect(
      p.room.create({ data: { activityId: 'a', key: 'main', name: 'Main 2' } }),
    ).resolves.toBeTruthy();
  });
});

describe('placement constraints', () => {
  it('a second placement for the same member and occurrence is rejected (across teams)', async () => {
    const { team, team2, occ } = await planner();
    const m = await member('P1');
    await p.placement.create({ data: { occurrenceId: occ.id, memberId: m.id, teamId: team.id, slot: 1 } });
    await expect(
      p.placement.create({ data: { occurrenceId: occ.id, memberId: m.id, teamId: team2.id, slot: 1 } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('two members in one slot are rejected; slot < 1 is rejected', async () => {
    const { team, occ } = await planner();
    const a = await member('A1');
    const b = await member('B1');
    await p.placement.create({ data: { occurrenceId: occ.id, memberId: a.id, teamId: team.id, slot: 2 } });
    await expect(
      p.placement.create({ data: { occurrenceId: occ.id, memberId: b.id, teamId: team.id, slot: 2 } }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      p.placement.create({ data: { occurrenceId: occ.id, memberId: b.id, teamId: team.id, slot: 0 } }),
    ).rejects.toThrow(/placement_slot_positive/);
  });

  it('deleting an occurrence cascades to registrations and placements; a team/room in use cannot be deleted', async () => {
    const { team, room, occ } = await planner();
    const m = await member('C1');
    await p.placement.create({ data: { occurrenceId: occ.id, memberId: m.id, teamId: team.id, slot: 1 } });
    await p.registration.create({
      data: { occurrenceId: occ.id, memberId: m.id, status: 'JOINED', registeredAt: new Date() },
    });
    await expect(p.team.delete({ where: { id: team.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(p.room.delete({ where: { id: room.id } })).rejects.toMatchObject({ code: 'P2003' });
    await p.occurrence.delete({ where: { id: occ.id } });
    expect(await p.placement.count()).toBe(0);
    expect(await p.registration.count()).toBe(0);
  });
});

describe('member referential integrity (never hard-deleted)', () => {
  type Ctx = { m: string; other: string; occ: number; team: number; round: number; item: number };
  const cases: [string, (c: Ctx) => Promise<unknown>][] = [
    [
      'Registration.memberId',
      (c) =>
        p.registration.create({
          data: { occurrenceId: c.occ, memberId: c.m, status: 'JOINED', registeredAt: new Date() },
        }),
    ],
    [
      'Registration.updatedById',
      (c) =>
        p.registration.create({
          data: {
            occurrenceId: c.occ,
            memberId: c.other,
            status: 'JOINED',
            registeredAt: new Date(),
            updatedById: c.m,
          },
        }),
    ],
    [
      'Placement.memberId',
      (c) => p.placement.create({ data: { occurrenceId: c.occ, memberId: c.m, teamId: c.team, slot: 1 } }),
    ],
    [
      'Placement.placedById',
      (c) =>
        p.placement.create({
          data: { occurrenceId: c.occ, memberId: c.other, teamId: c.team, slot: 1, placedById: c.m },
        }),
    ],
    [
      'Placement.backfilledForMemberId',
      (c) =>
        p.placement.create({
          data: {
            occurrenceId: c.occ,
            memberId: c.other,
            teamId: c.team,
            slot: 1,
            backfilledForMemberId: c.m,
          },
        }),
    ],
    [
      'AuctionRound.createdById',
      (c) => p.auctionRound.create({ data: { type: 'QUEUE_RANKED', name: 'x', createdById: c.m } }),
    ],
    [
      'AuctionItem.winnerId',
      (c) => p.auctionItem.update({ where: { id: c.item }, data: { winnerId: c.m, wonAt: new Date() } }),
    ],
    ['QueueEntry.memberId', (c) => p.queueEntry.create({ data: { category: 'GEAR', memberId: c.m } })],
    [
      'Preference.memberId',
      (c) => p.preference.create({ data: { roundId: c.round, memberId: c.m, itemId: c.item, rank: 1 } }),
    ],
    [
      'RoundQueueSnapshot.memberId',
      (c) =>
        p.roundQueueSnapshot.create({
          data: { roundId: c.round, category: 'GEAR', memberId: c.m, position: 1 },
        }),
    ],
    [
      'NotificationOutbox.recipientMemberId',
      (c) =>
        p.notificationOutbox.create({
          data: {
            eventType: 'e',
            target: 'DISCORD_DM',
            recipientMemberId: c.m,
            payload: {},
            dedupeKey: `k-${c.m}`,
          },
        }),
    ],
  ];

  it.each(cases)('%s blocks hard-deleting the member', async (_name, attach) => {
    const { team, occ } = await planner();
    const m = await member('Ref');
    const other = await member('Other');
    const r = await p.auctionRound.create({
      data: { type: 'LIVE_CLAIM', name: 'r', winCap: 5, createdById: other.id },
    });
    const item = await p.auctionItem.create({ data: { roundId: r.id, name: 'i', category: 'GEAR' } });
    await attach({ m: m.id, other: other.id, occ: occ.id, team: team.id, round: r.id, item: item.id });
    const err = await p.member.delete({ where: { id: m.id } }).catch((e) => e);
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err.code).toBe('P2003');
  });

  it('sessions are disposable: deleting a member cascades to Session', async () => {
    const m = await member('Sess');
    await p.session.create({ data: { id: 'abc', memberId: m.id, expiresAt: new Date(Date.now() + 1e6) } });
    await p.member.delete({ where: { id: m.id } });
    expect(await p.session.count()).toBe(0);
  });

  it('AuditLog has no foreign keys (history survives deletions)', async () => {
    const rows = await p.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.table_constraints
      WHERE table_name = 'AuditLog' AND constraint_type = 'FOREIGN KEY'`;
    expect(rows[0]!.n).toBe(0);
  });
});
