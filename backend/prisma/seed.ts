import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

// Source of truth for ids/times: frontend/src/data/guild.ts (jobs 1-8, 16 schedule events).
// dayOfWeek: 0 = Monday.
const jobs = [
  { id: 1, label: 'High Priest', color: '#5cb454' },
  { id: 2, label: 'Knight', color: '#e04e4b' },
  { id: 3, label: 'Wizard', color: '#3a95e8' },
  { id: 4, label: 'Sniper', color: '#e3b53c' },
  { id: 5, label: 'Gunslinger', color: '#b8682c' },
  { id: 6, label: 'ดรูอิด', color: '#3fb3a1' },
  { id: 7, label: 'Assassin', color: '#9a6fdc' },
  { id: 8, label: 'Paladin', color: '#bf3f35' },
];

type ActivitySeed = {
  id: string;
  name: string;
  isGuild?: boolean;
  hasPlanner?: boolean;
  autoBackfill?: boolean;
};
const activities: ActivitySeed[] = [
  { id: 'luminous-vale', name: 'Luminous Vale' },
  { id: 'graduate-exam', name: 'การประเมินบัณฑิต' },
  { id: 'polarity-zone', name: 'Polarity Zone', isGuild: true, hasPlanner: true, autoBackfill: true },
  { id: 'king-battle', name: 'ศึกราชันย์' },
  { id: 'king-battle-cross', name: 'ศึกราชันย์ข้ามเซิร์ฟ' },
  { id: 'sage-selection', name: 'การคัดเลือก Sage' },
  { id: 'clash-of-the-chosen', name: 'Clash of the Chosen' },
  { id: 'family-party', name: 'งานเลี้ยงครอบครัว' },
  { id: 'mirror-world', name: 'Mirror World', isGuild: true, hasPlanner: true },
  { id: 'hoppy-quiz', name: 'Hoppy Quiz' },
  { id: 'castle-siege', name: 'ศึกชิงปราสาท', hasPlanner: true },
  { id: 'guild-league', name: 'Guild League', isGuild: true, hasPlanner: true },
  { id: 'ancient-ruins', name: 'Ancient Ruins' },
  { id: 'hazy-forest', name: 'Hazy Forest', isGuild: true },
];

const events: { id: string; activityId: string; day: number; start: string; end: string }[] = [
  { id: 'luminous-vale', activityId: 'luminous-vale', day: 5, start: '08:00', end: '23:59' },
  { id: 'graduate-exam', activityId: 'graduate-exam', day: 4, start: '12:00', end: '18:00' },
  { id: 'polarity-zone', activityId: 'polarity-zone', day: 6, start: '12:00', end: '21:00' },
  { id: 'king-battle', activityId: 'king-battle', day: 5, start: '13:00', end: '23:59' },
  { id: 'king-battle-cross', activityId: 'king-battle-cross', day: 5, start: '18:00', end: '19:59' },
  { id: 'sage-selection', activityId: 'sage-selection', day: 4, start: '19:00', end: '19:30' },
  { id: 'clash-of-the-chosen', activityId: 'clash-of-the-chosen', day: 5, start: '20:00', end: '20:50' },
  { id: 'family-party', activityId: 'family-party', day: 1, start: '21:00', end: '21:25' },
  { id: 'mirror-world', activityId: 'mirror-world', day: 3, start: '21:00', end: '21:15' },
  { id: 'hoppy-quiz', activityId: 'hoppy-quiz', day: 4, start: '21:00', end: '21:30' },
  { id: 'castle-siege', activityId: 'castle-siege', day: 6, start: '21:00', end: '22:00' },
  { id: 'guild-league-tue-1', activityId: 'guild-league', day: 1, start: '21:30', end: '21:55' },
  { id: 'ancient-ruins', activityId: 'ancient-ruins', day: 2, start: '21:30', end: '22:15' },
  { id: 'hazy-forest', activityId: 'hazy-forest', day: 3, start: '21:30', end: '21:45' },
  { id: 'guild-league-tue-2', activityId: 'guild-league', day: 1, start: '22:00', end: '22:25' },
  { id: 'guild-league-thu', activityId: 'guild-league', day: 3, start: '22:00', end: '22:25' },
];

// Default layouts (design 4.3): rooms of `teams` x 5. Mirror World / Castle Siege are placeholders.
const layouts: Record<string, { key: string; name: string; teams: number }[]> = {
  'guild-league': [
    { key: 'main', name: 'Main', teams: 12 },
    { key: 'sub', name: 'Sub', teams: 18 },
  ],
  'polarity-zone': [{ key: 'default', name: 'Main', teams: 10 }],
  'mirror-world': [{ key: 'default', name: 'Main', teams: 8 }],
  'castle-siege': [{ key: 'default', name: 'Main', teams: 8 }],
};

// Fake dev members, including real Thai IGNs from the roster (combining marks, mixed scripts).
const devMembers = [
  { ign: 'แมวกระเป๋า', nickname: 'แมว', jobId: 1 },
  { ign: 'เสีEวค่ะXลวงMา', nickname: null, jobId: 6 },
  { ign: '-nara-', nickname: 'Nara', jobId: 3 },
  { ign: 'DevKnight', nickname: 'Kni', jobId: 2 },
  { ign: 'DevSniper', nickname: null, jobId: 4 },
];

/**
 * Idempotent, create-only seed: existing rows are never overwritten, so re-running it after
 * admins edited settings (capacity, jobs, layout) does not clobber their changes.
 */
export async function seed(prisma: PrismaClient, opts: { dev?: boolean } = {}) {
  for (const [i, j] of jobs.entries()) {
    await prisma.job.upsert({ where: { id: j.id }, update: {}, create: { ...j, sortOrder: i } });
  }
  // Explicit ids leave the sequence at 1; move it so the next admin-created job does not collide.
  await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('"Job"','id'), (SELECT max(id) FROM "Job"))`;

  for (const [i, a] of activities.entries()) {
    await prisma.activity.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        name: a.name,
        isGuild: a.isGuild ?? false,
        hasPlanner: a.hasPlanner ?? false,
        autoBackfill: a.autoBackfill ?? false,
        registrationCapacity: null,
        notifyChannelId: null,
        sortOrder: i,
      },
    });
  }
  for (const [i, e] of events.entries()) {
    await prisma.scheduleEvent.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id,
        activityId: e.activityId,
        dayOfWeek: e.day,
        startTime: e.start,
        endTime: e.end,
        sortOrder: i,
      },
    });
  }

  for (const [activityId, rooms] of Object.entries(layouts)) {
    for (const [ri, r] of rooms.entries()) {
      let room = await prisma.room.findFirst({ where: { activityId, key: r.key, archivedAt: null } });
      room ??= await prisma.room.create({ data: { activityId, key: r.key, name: r.name, sortOrder: ri } });
      if ((await prisma.team.count({ where: { roomId: room.id } })) === 0) {
        await prisma.team.createMany({
          data: Array.from({ length: r.teams }, (_, t) => ({
            roomId: room.id,
            name: `Team ${t + 1}`,
            size: 5,
            sortOrder: t,
          })),
        });
      }
    }
  }

  if (opts.dev) {
    for (const [i, m] of devMembers.entries()) {
      const discordId = String(900000000000000000n + BigInt(i));
      await prisma.member.upsert({
        where: { discordId },
        update: {},
        create: {
          discordId,
          ign: m.ign.normalize('NFC'),
          nickname: m.nickname,
          jobId: m.jobId,
          isAdmin: i === 0,
        },
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  seed(prisma, { dev: process.env.SEED_DEV_MEMBERS === '1' || process.argv.includes('--dev') })
    .then(() => console.log('seed complete'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
