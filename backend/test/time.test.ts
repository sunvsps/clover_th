import { describe, expect, it } from 'vitest';
import {
  addDays,
  bangkokToday,
  daysBetween,
  dayOfWeekOf,
  dbDateToStr,
  isValidDateStr,
  mondayOf,
  startsAtUtc,
  withinWindow,
} from '../src/lib/time.js';

describe('time helpers (Asia/Bangkok, Monday first)', () => {
  it.each([
    ['2026-09-21', 0],
    ['2026-09-22', 1],
    ['2026-09-23', 2],
    ['2026-09-24', 3],
    ['2026-09-25', 4],
    ['2026-09-26', 5],
    ['2026-09-27', 6],
  ])('dayOfWeekOf %s = %i (0 = Monday, unlike Luxon and getDay)', (d, want) => {
    expect(dayOfWeekOf(d)).toBe(want);
  });

  it.each([
    ['2026-09-20T16:59:59.999Z', '2026-09-20'], // 23:59:59.999 Bangkok Sunday
    ['2026-09-20T17:00:00.000Z', '2026-09-21'], // 00:00 Bangkok Monday
    ['2026-09-21T16:59:59.000Z', '2026-09-21'],
    ['2026-12-31T17:00:00.000Z', '2027-01-01'], // year boundary
    ['2026-09-21T00:00:00.000Z', '2026-09-21'], // 07:00 Bangkok
  ])('bangkokToday(%s) = %s', (iso, want) => {
    expect(bangkokToday(new Date(iso))).toBe(want);
  });

  it('the Bangkok week starts on Monday (Sunday belongs to the previous Monday)', () => {
    expect(mondayOf('2026-09-20')).toBe('2026-09-14');
    expect(mondayOf('2026-09-21')).toBe('2026-09-21');
    expect(mondayOf('2026-09-27')).toBe('2026-09-21');
  });

  it('startsAtUtc converts Bangkok wall time to UTC (00:00 Bangkok is 17:00 UTC the previous day)', () => {
    expect(startsAtUtc('2026-09-21', '00:00').toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(startsAtUtc('2026-09-21', '00:30').toISOString()).toBe('2026-09-20T17:30:00.000Z');
    expect(startsAtUtc('2026-09-21', '21:30').toISOString()).toBe('2026-09-21T14:30:00.000Z');
    expect(startsAtUtc('2026-09-21', '23:59').toISOString()).toBe('2026-09-21T16:59:00.000Z');
  });

  it('dbDateToStr reads a Prisma @db.Date (UTC midnight) without shifting the day', () => {
    expect(dbDateToStr(new Date('2026-09-21T00:00:00.000Z'))).toBe('2026-09-21');
    expect(dbDateToStr(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });

  it('validates date strings and does arithmetic', () => {
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2026-9-1')).toBe(false);
    expect(isValidDateStr('2026-09-21')).toBe(true);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(daysBetween('2026-09-21', '2026-10-04')).toBe(13);
  });

  it('the window is +/- 8 weeks from today', () => {
    const now = new Date('2026-09-20T05:00:00Z');
    expect(withinWindow('2026-11-15', now)).toBe(true); // +56 days
    expect(withinWindow('2026-11-16', now)).toBe(false);
    expect(withinWindow('2026-07-26', now)).toBe(true); // -56 days
    expect(withinWindow('2026-07-25', now)).toBe(false);
  });
});
