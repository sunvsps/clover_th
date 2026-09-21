import { http, HttpResponse } from "msw";
import type { Me, WireActivity, WireEvent, WireJob, WireMember } from "../api";
import { server } from "./server";

export const wireJobs: WireJob[] = ["High Priest", "Knight", "Wizard", "Sniper", "Gunslinger", "Assassin", "Paladin", "Monk"].map(
  (label, index) => ({ id: index + 1, label, color: `#${(0x3a7bd5 + index * 0x101010).toString(16)}`, sortOrder: index, inUse: true }),
);

export const wireMembers: WireMember[] = [
  { id: "m-aria", ign: "Aria", nickname: null, jobId: 1 },
  { id: "m-bo", ign: "Bo", nickname: null, jobId: 2 },
  { id: "m-cleo", ign: "Cleo", nickname: null, jobId: 3 },
  { id: "m-dax", ign: "Dax", nickname: null, jobId: 4 },
];

export const wireEvents: WireEvent[] = [
  { id: "e-1", activityId: "a-1", name: "Guild War", isGuild: true, dayOfWeek: 2, startTime: "20:00", endTime: "21:00" },
  { id: "e-2", activityId: "a-2", name: "Boss Hunt", isGuild: false, dayOfWeek: 5, startTime: "19:30", endTime: "20:30" },
];

export const wireActivities: WireActivity[] = [
  { id: "a-1", name: "Guild War", isGuild: true, hasPlanner: true, registrationCapacity: null, autoBackfill: false, layoutCapacity: 20 },
  { id: "a-2", name: "Boss Hunt", isGuild: false, hasPlanner: false, registrationCapacity: 10, autoBackfill: false, layoutCapacity: 0 },
];

export const meAdmin: Me = {
  memberId: "m-aria",
  discordId: "900000000000000000",
  ign: "Aria",
  nickname: null,
  job: { id: 1, label: "High Priest", color: "#3a7bd5" },
  isAdmin: true,
  isIncomplete: false,
  serverTime: "2026-09-21T10:00:00.000Z",
};

export const meUser: Me = { ...meAdmin, memberId: "m-bo", ign: "Bo", isAdmin: false, job: { id: 2, label: "Knight", color: "#4a8be5" } };

const authRequired = () =>
  HttpResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sign in", details: {} } }, { status: 401 });

/** Registers MSW handlers for the four data endpoints; `me: null` answers 401 AUTH_REQUIRED. */
export function mockApi({ me = meAdmin }: { me?: Me | null } = {}) {
  server.use(
    http.get("*/api/v1/me", () => (me ? HttpResponse.json(me) : authRequired())),
    http.get("*/api/v1/members", () => HttpResponse.json(wireMembers)),
    http.get("*/api/v1/jobs", () => HttpResponse.json(wireJobs)),
    http.get("*/api/v1/events", () => HttpResponse.json(wireEvents)),
    http.get("*/api/v1/activities", () => HttpResponse.json(wireActivities)),
    http.post("*/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),
  );
}

/** UI-domain roster used by the hook-level harness (already adapted from the wire shapes). */
export const testJobs = wireJobs.map((j) => ({ id: j.id, label: j.label, color: j.color }));
export const testMembers = wireMembers.map((m) => ({ id: m.id, ign: m.ign, job: m.jobId }));
