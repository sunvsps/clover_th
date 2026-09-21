import type { World } from '../helpers/world.js';

export type H = Record<string, string>;

export const api = (w: World) => ({
  plan: (h: H, ev: string, date: string) =>
    w.app.inject({ url: `/api/v1/events/${ev}/occurrences/${date}/plan`, headers: h }),
  place: (h: H, ev: string, date: string, memberId: string, body: object) =>
    w.app.inject({
      method: 'PUT',
      url: `/api/v1/events/${ev}/occurrences/${date}/plan/placements/${memberId}`,
      headers: h,
      payload: body,
    }),
  clear: (h: H, ev: string, date: string, body: object) =>
    w.app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev}/occurrences/${date}/plan/clear`,
      headers: h,
      payload: body,
    }),
  copy: (h: H, ev: string, date: string, body: object) =>
    w.app.inject({
      method: 'POST',
      url: `/api/v1/events/${ev}/occurrences/${date}/plan/copy-from-previous`,
      headers: h,
      payload: body,
    }),
  layout: (h: H, activity: string) =>
    w.app.inject({ url: `/api/v1/admin/activities/${activity}/layout`, headers: h }),
  putLayout: (h: H, activity: string, rooms: object[]) =>
    w.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/activities/${activity}/layout`,
      headers: h,
      payload: { rooms },
    }),
  teams: (activityId: string) =>
    w.db.prisma.team.findMany({ where: { room: { activityId } }, orderBy: { id: 'asc' } }),
  occ: (eventId: string, date: string) =>
    w.db.prisma.occurrence.findFirstOrThrow({ where: { eventId, date: new Date(date) } }),
  members: (n: number, prefix = 'P') =>
    Promise.all(Array.from({ length: n }, (_, i) => w.member(`${prefix}${i}`))),
  /** Places a member directly in the DB (test setup). */
  put: (
    occurrenceId: number,
    memberId: string,
    teamId: number,
    slot: number,
    source: 'ADMIN' | 'COPY' | 'AUTO_BACKFILL' = 'ADMIN',
  ) => w.db.prisma.placement.create({ data: { occurrenceId, memberId, teamId, slot, source } }),
});

/** Flattens a plan response to `memberId -> [teamId, slot]`. */
export const slots = (plan: {
  rooms: { teams: { id: number; placements: { memberId: string; slot: number }[] }[] }[];
}) =>
  Object.fromEntries(
    plan.rooms.flatMap((r) =>
      r.teams.flatMap((t) => t.placements.map((p) => [p.memberId, [t.id, p.slot]] as const)),
    ),
  );
