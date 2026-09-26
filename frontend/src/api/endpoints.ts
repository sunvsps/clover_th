import type { GuildMember, Job, ScheduleEvent } from "../data/guild";
import { toGuildMember, toJob, toScheduleEvent, type Me, type WireActivity, type WireEvent, type WireJob, type WireMember } from "./adapters";
import { get, post, put } from "./client";

/** Where the Sign-in button goes. The backend sets the session cookie and redirects back to the app. */
export const LOGIN_URL = "/api/v1/auth/discord/login";

export const getMe = () => get<Me>("/api/v1/me");
export const logout = () => post<void>("/api/v1/auth/logout");
/** Remembers the UI language on the member (returned by `/me` as `language` from then on). */
export const saveLanguage = (language: "en" | "th") => put<{ language: "en" | "th" }>("/api/v1/me/language", { language });

export const getMembers = async (): Promise<GuildMember[]> => (await get<WireMember[]>("/api/v1/members")).map(toGuildMember);
export const getJobs = async (): Promise<Job[]> => (await get<WireJob[]>("/api/v1/jobs")).map(toJob);
export const getEvents = async (): Promise<ScheduleEvent[]> => (await get<WireEvent[]>("/api/v1/events")).map(toScheduleEvent);
export const getActivities = () => get<WireActivity[]>("/api/v1/activities");

export type GuildData = {
  members: GuildMember[];
  jobs: Job[];
  events: ScheduleEvent[];
  activities: WireActivity[];
};

/** Everything the signed-in shell needs before it can render, fetched in parallel. */
export async function loadGuildData(): Promise<GuildData> {
  const [members, jobs, events, activities] = await Promise.all([getMembers(), getJobs(), getEvents(), getActivities()]);
  return { members, jobs, events, activities };
}
