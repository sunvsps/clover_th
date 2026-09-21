import { DateTime } from 'luxon';

/**
 * Time helpers (design 3.3). Occurrence dates are Bangkok calendar dates as 'YYYY-MM-DD' strings.
 * dayOfWeek is 0 = Monday (frontend and DB), unlike Luxon weekday (1 = Monday) and JS getDay() (0 = Sunday):
 * the conversion happens here and nowhere else. Thailand has no DST.
 */
export const BANGKOK = 'Asia/Bangkok';
export const WINDOW_WEEKS = 8;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(s: string): boolean {
  return DATE_RE.test(s) && DateTime.fromISO(s, { zone: BANGKOK }).isValid;
}

/** 0 = Monday ... 6 = Sunday, for a Bangkok calendar date string. */
export function dayOfWeekOf(dateStr: string): number {
  return DateTime.fromISO(dateStr, { zone: BANGKOK }).weekday - 1;
}

/** Today's Bangkok calendar date. */
export function bangkokToday(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: BANGKOK }).toISODate()!;
}

/** Monday of the Bangkok week containing the date. */
export function mondayOf(dateStr: string): string {
  const d = DateTime.fromISO(dateStr, { zone: BANGKOK });
  return d.minus({ days: d.weekday - 1 }).toISODate()!;
}

export function addDays(dateStr: string, days: number): string {
  return DateTime.fromISO(dateStr, { zone: BANGKOK }).plus({ days }).toISODate()!;
}

export function daysBetween(fromStr: string, toStr: string): number {
  const a = DateTime.fromISO(fromStr, { zone: BANGKOK }).startOf('day');
  const b = DateTime.fromISO(toStr, { zone: BANGKOK }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/** Reads and writes are limited to about +/- 8 weeks from today. */
export function withinWindow(dateStr: string, now: Date = new Date()): boolean {
  return Math.abs(daysBetween(bangkokToday(now), dateStr)) <= WINDOW_WEEKS * 7;
}

/** UTC instant for a Bangkok date + wall-clock 'HH:mm'. */
export function startsAtUtc(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.fromISO(dateStr, { zone: BANGKOK })
    .set({ hour: h!, minute: m!, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

/** Prisma returns @db.Date as a UTC-midnight Date; convert to a 'YYYY-MM-DD' string (never via local time). */
export function dbDateToStr(d: Date): string {
  return DateTime.fromJSDate(d, { zone: BANGKOK }).toISODate()!;
}
