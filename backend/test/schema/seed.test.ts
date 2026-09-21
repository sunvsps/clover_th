import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma, { dev: true });
});
afterAll(() => db.drop());

const counts = async () => ({
  jobs: await db.prisma.job.count(),
  activities: await db.prisma.activity.count(),
  events: await db.prisma.scheduleEvent.count(),
  rooms: await db.prisma.room.count(),
  teams: await db.prisma.team.count(),
  members: await db.prisma.member.count(),
});

describe('seed', () => {
  it('seeding twice creates no duplicates', async () => {
    const before = await counts();
    await seed(db.prisma, { dev: true });
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ jobs: 8, activities: 14, events: 16, rooms: 5, teams: 56, members: 5 });
  });

  it('does not overwrite admin edits when re-run', async () => {
    await db.prisma.activity.update({ where: { id: 'hazy-forest' }, data: { registrationCapacity: 30 } });
    await db.prisma.job.update({ where: { id: 1 }, data: { color: '#000000' } });
    await seed(db.prisma);
    expect(
      (await db.prisma.activity.findUniqueOrThrow({ where: { id: 'hazy-forest' } })).registrationCapacity,
    ).toBe(30);
    expect((await db.prisma.job.findUniqueOrThrow({ where: { id: 1 } })).color).toBe('#000000');
    await db.prisma.activity.update({ where: { id: 'hazy-forest' }, data: { registrationCapacity: null } });
  });

  it('creating a 9th job after seed succeeds (sequence reset)', async () => {
    const job = await db.prisma.job.create({ data: { label: 'Ninth', color: '#123456' } });
    expect(job.id).toBe(9);
  });

  it('seeds jobs 1-8 with the frontend labels', async () => {
    const jobs = await db.prisma.job.findMany({ where: { id: { lte: 8 } }, orderBy: { id: 'asc' } });
    expect(jobs.map((j) => j.label)).toEqual([
      'High Priest',
      'Knight',
      'Wizard',
      'Sniper',
      'Gunslinger',
      'ดรูอิด',
      'Assassin',
      'Paladin',
    ]);
  });

  it('seeds the 16 schedule events with the frontend ids and times', async () => {
    const events = await db.prisma.scheduleEvent.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((e) => e.id)).toEqual(
      [
        'ancient-ruins',
        'castle-siege',
        'clash-of-the-chosen',
        'family-party',
        'graduate-exam',
        'guild-league-thu',
        'guild-league-tue-1',
        'guild-league-tue-2',
        'hazy-forest',
        'hoppy-quiz',
        'king-battle',
        'king-battle-cross',
        'luminous-vale',
        'mirror-world',
        'polarity-zone',
        'sage-selection',
      ].sort(),
    );
    const g = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(g['guild-league-tue-1']).toMatchObject({
      activityId: 'guild-league',
      dayOfWeek: 1,
      startTime: '21:30',
      endTime: '21:55',
    });
    expect(g['guild-league-thu']).toMatchObject({
      activityId: 'guild-league',
      dayOfWeek: 3,
      startTime: '22:00',
    });
    expect(g['polarity-zone']).toMatchObject({ dayOfWeek: 6, startTime: '12:00', endTime: '21:00' });
    expect(g['luminous-vale']).toMatchObject({ dayOfWeek: 5, endTime: '23:59' });
  });

  it('seeded layout capacities are 60, 90, 50, 40, 40', async () => {
    const rows = await db.prisma.$queryRaw<{ activityId: string; key: string; cap: number }[]>`
      SELECT r."activityId", r.key, SUM(t.size)::int AS cap
      FROM "Room" r JOIN "Team" t ON t."roomId" = r.id
      WHERE r."archivedAt" IS NULL AND t."archivedAt" IS NULL
      GROUP BY r.id ORDER BY r."activityId", r.key`;
    expect(rows.map((r) => `${r.activityId}/${r.key}=${r.cap}`)).toEqual([
      'castle-siege/default=40',
      'guild-league/main=60',
      'guild-league/sub=90',
      'mirror-world/default=40',
      'polarity-zone/default=50',
    ]);
  });

  it('polarity-zone.autoBackfill is true and all others false; capacity is null everywhere', async () => {
    const acts = await db.prisma.activity.findMany();
    expect(acts.filter((a) => a.autoBackfill).map((a) => a.id)).toEqual(['polarity-zone']);
    expect(acts.every((a) => a.registrationCapacity === null && a.notifyChannelId === null)).toBe(true);
    expect(acts.find((a) => a.id === 'hazy-forest')!.hasPlanner).toBe(false);
    expect(
      acts
        .filter((a) => a.hasPlanner)
        .map((a) => a.id)
        .sort(),
    ).toEqual(['castle-siege', 'guild-league', 'mirror-world', 'polarity-zone']);
  });

  it('dev seed includes the real Thai IGN samples', async () => {
    const igns = (await db.prisma.member.findMany()).map((m) => m.ign);
    expect(igns).toEqual(expect.arrayContaining(['แมวกระเป๋า', 'เสีEวค่ะXลวงMา', '-nara-']));
  });

  it('the database is UTF8 and normalize() works', async () => {
    const [enc] = await db.prisma.$queryRaw<{ e: string }[]>`SELECT current_setting('server_encoding') AS e`;
    expect(enc!.e).toBe('UTF8');
    const [n] = await db.prisma.$queryRaw<{ ok: boolean }[]>`SELECT normalize(${'é'}, NFC) = ${'é'} AS ok`;
    expect(n!.ok).toBe(true);
  });
});
