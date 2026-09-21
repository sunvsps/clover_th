/**
 * Calendar helpers in Asia/Bangkok (no DST), Monday first. The whole app talks about days as `YYYY-MM-DD` strings
 * ("date keys"): the API, the attendance keys and the schedule all use them. Keys are computed with Intl in the
 * Bangkok zone, NEVER from the browser's local time, so they are identical wherever the browser runs, including
 * around 00:00 Bangkok (17:00 UTC the previous day). `dayOfWeek` is 0 = Monday, as in the API.
 */
export const BANGKOK_TZ = "Asia/Bangkok";

export type DateKey = string; // YYYY-MM-DD

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANGKOK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Bangkok calendar date of an instant. */
export function toDateKey(instant: Date | number = new Date()): DateKey {
  const parts = partsFormat.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const todayKey = (now: Date | number = new Date()): DateKey => toDateKey(now);

const utcMidnight = (key: DateKey) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fromUtcMidnight = (ms: number): DateKey => new Date(ms).toISOString().slice(0, 10);

export const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtcMidnight(utcMidnight(value)) === value;

/** Pure calendar arithmetic on date keys (no time zone involved). */
export const addDays = (key: DateKey, days: number): DateKey => fromUtcMidnight(utcMidnight(key) + days * 86_400_000);

/** 0 = Monday ... 6 = Sunday. */
export const dayOfWeek = (key: DateKey): number => (new Date(utcMidnight(key)).getUTCDay() + 6) % 7;

/** Monday of the week containing the date. */
export const startOfWeek = (key: DateKey): DateKey => addDays(key, -dayOfWeek(key));

export const daysBetween = (from: DateKey, to: DateKey) => Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);

const thaiShortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const enShortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 ก.ย." / "20 Sep" for a date key. */
export function formatDay(key: DateKey, isThai: boolean): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${(isThai ? thaiShortMonths : enShortMonths)[m! - 1]}`;
}

export const yearOf = (key: DateKey) => Number(key.slice(0, 4));

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BANGKOK_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
/** "HH:mm" wall-clock time in Bangkok for an ISO instant. */
export const bangkokTime = (iso: string | Date) => timeFormat.format(typeof iso === "string" ? new Date(iso) : iso);

/** The instant (epoch ms) an occurrence starts: `dateKey` at wall-clock `HH:mm` in Bangkok (UTC+7, no DST). */
export const occurrenceStartMs = (key: DateKey, hhmm: string) => Date.parse(`${key}T${hhmm}:00+07:00`);
