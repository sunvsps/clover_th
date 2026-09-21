import type { GuildMember, Job, ScheduleEvent } from "../data/guild";
import type { paths } from "./schema";

type Json<P extends keyof paths, M extends "get" | "put" | "post" | "patch" | "delete"> = paths[P] extends Record<M, infer Op>
  ? Op extends { responses: { 200: { content: { "application/json": infer B } } } }
    ? B
    : never
  : never;

export type Me = Json<"/api/v1/me", "get">;
export type WireMember = Json<"/api/v1/members", "get">[number];
export type WireJob = Json<"/api/v1/jobs", "get">[number];
export type WireEvent = Json<"/api/v1/events", "get">[number];
export type WireActivity = Json<"/api/v1/activities", "get">[number];

/** Wire members/jobs/events -> the UI domain types (`src/data/guild.ts`). */
export const toGuildMember = (m: WireMember): GuildMember => ({ id: m.id, ign: m.ign, job: m.jobId });
export const toJob = (j: WireJob): Job => ({ id: j.id, label: j.label, color: j.color });
export const toScheduleEvent = (e: WireEvent): ScheduleEvent => ({
  id: e.id,
  activityId: e.activityId,
  name: e.name,
  day: e.dayOfWeek,
  slot: e.startTime, // the grid row is the start time; the API does not return a slot
  start: e.startTime,
  end: e.endTime,
  guild: e.isGuild || undefined,
});
