import { AppError } from './errors.js';
import { dayOfWeekOf, isValidDateStr, startsAtUtc, withinWindow } from './time.js';
import type { Tx } from './tx.js';

export type OccurrenceRow = {
  id: number;
  eventId: string;
  activityId: string;
  startsAt: Date;
  planVersion: number;
  /** startsAt <= clock_timestamp(), evaluated by the DB at read time. */
  started: boolean;
};

export type EventRow = { id: string; activityId: string; dayOfWeek: number; startTime: string };

export async function findEvent(tx: Tx | { $queryRaw: Tx['$queryRaw'] }, eventId: string): Promise<EventRow> {
  const rows = await tx.$queryRaw<EventRow[]>`
    SELECT id, "activityId", "dayOfWeek", "startTime" FROM "ScheduleEvent" WHERE id = ${eventId}`;
  if (!rows[0]) throw new AppError('NOT_FOUND', 404, 'Event not found');
  return rows[0];
}

/**
 * Get-or-create for WRITES only, called with the Activity lock held (raw INSERT ... ON CONFLICT DO NOTHING
 * then SELECT; Prisma upsert is not atomic). Reads must use readOccurrence and never create rows.
 */
export async function getOrCreateOccurrence(tx: Tx, eventId: string, date: string): Promise<OccurrenceRow> {
  const ev = await findEvent(tx, eventId);
  assertOccurrenceDate(ev, date);
  await tx.$executeRaw`
    INSERT INTO "Occurrence" ("eventId", date, "startsAt")
    VALUES (${eventId}, ${date}::date, ${startsAtUtc(date, ev.startTime)})
    ON CONFLICT ("eventId", date) DO NOTHING`;
  const occ = await readOccurrence(tx, eventId, date);
  if (!occ) throw new AppError('INTERNAL_ERROR', 500, 'Occurrence missing after insert');
  return occ;
}

export async function readOccurrence(
  tx: Pick<Tx, '$queryRaw'>,
  eventId: string,
  date: string,
): Promise<OccurrenceRow | null> {
  const rows = await tx.$queryRaw<OccurrenceRow[]>`
    SELECT o.id, o."eventId", e."activityId", o."startsAt", o."planVersion",
           o."startsAt" <= clock_timestamp() AS started
    FROM "Occurrence" o JOIN "ScheduleEvent" e ON e.id = o."eventId"
    WHERE o."eventId" = ${eventId} AND o.date = ${date}::date`;
  return rows[0] ?? null;
}

export function assertOccurrenceDate(ev: { dayOfWeek: number }, date: string, now: Date = new Date()) {
  if (!isValidDateStr(date)) throw new AppError('INVALID_OCCURRENCE_DATE', 422, 'Invalid date');
  if (dayOfWeekOf(date) !== ev.dayOfWeek) {
    throw new AppError('INVALID_OCCURRENCE_DATE', 422, 'Date does not match the event weekday');
  }
  if (!withinWindow(date, now)) throw new AppError('INVALID_OCCURRENCE_DATE', 422, 'Date is out of range');
}
