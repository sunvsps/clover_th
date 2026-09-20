import { startsAtUtc } from '../../src/lib/time.js';
import { futureDate } from '../helpers/dates.js';
import type { World } from '../helpers/world.js';
import type { api } from './helpers.js';

const PZ = 'polarity-zone';

/**
 * A plan with `placed` JOINED+placed members (filled team by team) and `reserves` JOINED unplaced members,
 * registered in that order one second apart (so reserve order is placed..., then R1, R2, ...).
 */
export const makeScene = (w: World, A: ReturnType<typeof api>) =>
  async function scene(o: { placed: number; reserves: number; date?: string; event?: string; tag?: string }) {
    const date = o.date ?? futureDate(6);
    const occ = await w.db.prisma.occurrence.create({
      data: { eventId: o.event ?? PZ, date: new Date(date), startsAt: startsAtUtc(date, '12:00') },
    });
    const teams = await A.teams(PZ);
    const placed = await A.members(o.placed, `${o.tag ?? ''}Pl`);
    const reserves = await A.members(o.reserves, `${o.tag ?? ''}Rs`);
    const t0 = Date.now() - 3_600_000;
    await w.db.prisma.registration.createMany({
      data: [...placed, ...reserves].map((m, i) => ({
        occurrenceId: occ.id,
        memberId: m.id,
        status: 'JOINED' as const,
        registeredAt: new Date(t0 + i * 1000),
      })),
    });
    for (const [i, m] of placed.entries())
      await A.put(occ.id, m.id, teams[Math.floor(i / 5)]!.id, (i % 5) + 1);
    return { date, occ, teams, placed, reserves };
  };
