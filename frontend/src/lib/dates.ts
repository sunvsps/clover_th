// All calendar math is done on "YYYY-MM-DD" keys in Asia/Bangkok, independent of the browser's timezone.
export const GUILD_TZ = "Asia/Bangkok";

const partsFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: GUILD_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date key in guild time. */
export const todayKey = (now: number = Date.now()) => partsFormatter.format(new Date(now)); // en-CA gives YYYY-MM-DD

export const keyToUtcDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const utcDateToKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export const addDays = (key: string, days: number) => {
  const date = keyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToKey(date);
};
/** 0 = Monday … 6 = Sunday (matches the API's dayOfWeek). */
export const weekdayOf = (key: string) => (keyToUtcDate(key).getUTCDay() + 6) % 7;
export const startOfWeek = (key: string) => addDays(key, -weekdayOf(key));

export const thaiShortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const enShortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatDay = (key: string, isThai: boolean) => {
  const date = keyToUtcDate(key);
  return `${date.getUTCDate()} ${(isThai ? thaiShortMonths : enShortMonths)[date.getUTCMonth()]}`;
};
export const yearOf = (key: string) => keyToUtcDate(key).getUTCFullYear();

export const weekDayNames = {
  th: ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
export const weekDayShort = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

/** Formats an ISO timestamp in guild time. */
export const formatDateTime = (iso: string, isThai: boolean) =>
  new Intl.DateTimeFormat(isThai ? "th-TH" : "en-GB", { timeZone: GUILD_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const formatClock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: GUILD_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
