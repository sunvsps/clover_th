import type { CSSProperties } from "react";

/**
 * Domain types and pure helpers only. Runtime data (roster, jobs, schedule) comes from the API (`src/api/`);
 * nothing in here is seed data. Calendar helpers live in `src/lib/bangkok.ts`.
 */

export type Job = {
  id: number;
  label: string;
  color: string; // hex, admin-editable
};

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
export const luminance = (hex: string) => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((offset) => channel(parseInt(full.slice(offset, offset + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Dark ink on mid/light colours, light ink on deep ones — keeps card text readable for any admin-picked colour. */
export const inkFor = (hex: string) => (luminance(hex) > 0.16 ? "#0f1410" : "#fbfbf7");
export const jobStyle = (job: Job | undefined): CSSProperties =>
  ({ "--job-bg": job?.color ?? "#7c8879", "--job-fg": inkFor(job?.color ?? "#7c8879") }) as CSSProperties;
export const findJob = (jobs: Job[], id: number) => jobs.find((job) => job.id === id);

/** A guild member. `id` is the immutable memberId used as the key everywhere; `ign` is what is displayed. */
export type GuildMember = {
  id: string;
  ign: string;
  job: number;
};

/** UI-side attendance. The wire uses JOINED/LEAVE/...; the mapping lives in `src/api/enums.ts` only. */
export type Attendance = "joined" | "leave";

/** Attendance is keyed by "<YYYY-MM-DD>:<eventId>" then by memberId. */
export const attendanceKey = (dateKey: string, eventId: string) => `${dateKey}:${eventId}`;

export type ScheduleEvent = {
  id: string;
  activityId: string;
  name: string;
  day: number; // 0 = Monday … 6 = Sunday
  slot: string; // time row it sits in (derived from `start`; the API does not return it)
  start: string;
  end: string;
  guild?: boolean; // hammer icon in game = guild activity
};

/** The distinct start times of the events, earliest first: the rows of the weekly grid. */
export const timeSlotsOf = (events: ScheduleEvent[]) => [...new Set(events.map((event) => event.slot))].sort();

export const weekDayNames = {
  th: ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
export const weekDayShort = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
