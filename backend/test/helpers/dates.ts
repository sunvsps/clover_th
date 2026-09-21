import { addDays, bangkokToday, dayOfWeekOf } from '../../src/lib/time.js';

/** The `nth` (1-based) date with the given weekday (0 = Monday) that is at least 2 days in the future (Bangkok). */
export function futureDate(dow: number, nth = 1): string {
  let d = addDays(bangkokToday(), 2);
  while (dayOfWeekOf(d) !== dow) d = addDays(d, 1);
  return addDays(d, 7 * (nth - 1));
}

/** The most recent date with the given weekday that is strictly before today (so its start is in the past). */
export function pastDate(dow: number): string {
  let d = addDays(bangkokToday(), -1);
  while (dayOfWeekOf(d) !== dow) d = addDays(d, -1);
  return d;
}
