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
    http.get("*/api/v1/registrations", () => HttpResponse.json({ from: "", to: "", serverTime: new Date().toISOString(), occurrences: {} })),
    http.post("*/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),
  );
}

/** UI-domain roster used by the hook-level harness (already adapted from the wire shapes). */
export const testJobs = wireJobs.map((j) => ({ id: j.id, label: j.label, color: j.color }));
export const testMembers = wireMembers.map((m) => ({ id: m.id, ign: m.ign, job: m.jobId }));

type FakeRow = { memberId: string; status: "JOINED" | "WAITLISTED" | "LEAVE" };
type Wire = { memberId: string; status: FakeRow["status"]; waitlistPos?: number; placed?: boolean; reserveOrder?: number | null };

/**
 * A small in-memory stand-in for the registrations API: capacity + waitlist + promotion (the real rules live in the
 * backend and are tested there). `key` is "YYYY-MM-DD:eventId". Handlers are added with `server.use`.
 */
export function fakeRegistrations(opts: { me: Me; capacity?: Record<string, number>; planner?: Set<string>; failWith?: string }) {
  const rows = new Map<string, FakeRow[]>();
  const puts: { url: string; body: unknown; xrw: string | null }[] = [];
  const gets: { from: string; to: string }[] = [];
  const activityOfEvent = (eventId: string) => wireEvents.find((e) => e.id === eventId)?.activityId ?? "";
  const list = (key: string) => rows.get(key) ?? rows.set(key, []).get(key)!;

  const wire = (key: string): Wire[] => {
    const all = list(key);
    const planner = opts.planner?.has(activityOfEvent(key.slice(11)));
    let waitPos = 0;
    let reserve = 0;
    return all.map((r) => {
      const w: Wire = { memberId: r.memberId, status: r.status };
      if (r.status === "WAITLISTED") w.waitlistPos = ++waitPos;
      if (planner) {
        w.placed = r.status === "JOINED" && placed.has(`${key}|${r.memberId}`);
        w.reserveOrder = r.status === "JOINED" && !w.placed ? ++reserve : null;
      }
      return w;
    });
  };
  const placed = new Set<string>();

  server.use(
    http.get("*/api/v1/registrations", ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      gets.push({ from, to });
      const occurrences: Record<string, Wire[]> = {};
      for (const key of rows.keys()) if (key.slice(0, 10) >= from && key.slice(0, 10) <= to && list(key).length) occurrences[key] = wire(key);
      return HttpResponse.json({ from, to, serverTime: new Date().toISOString(), occurrences });
    }),
    http.put("*/api/v1/events/:eventId/occurrences/:date/registrations/:memberId", async ({ request, params }) => {
      const body = (await request.json()) as { status: "JOINED" | "LEAVE" | "NONE" };
      puts.push({ url: new URL(request.url).pathname, body, xrw: request.headers.get("x-requested-with") });
      if (opts.failWith) return HttpResponse.json({ error: { code: opts.failWith, message: "x", details: {} } }, { status: 409 });
      const target = params.memberId === "me" ? opts.me.memberId : String(params.memberId);
      if (target !== opts.me.memberId && !opts.me.isAdmin)
        return HttpResponse.json({ error: { code: "FORBIDDEN_OTHER_MEMBER", message: "x", details: {} } }, { status: 403 });
      const key = `${params.date}:${params.eventId}`;
      const result = fakeSet(key, String(params.eventId), target, body.status);
      return HttpResponse.json(result);
    }),
  );

  function fakeSet(key: string, eventId: string, memberId: string, requested: "JOINED" | "LEAVE" | "NONE") {
    const all = list(key);
    const cap = opts.capacity?.[activityOfEvent(eventId)];
    const idx = all.findIndex((r) => r.memberId === memberId);
    const wasJoined = idx >= 0 && all[idx]!.status === "JOINED";
    if (idx >= 0) all.splice(idx, 1);
    let status: FakeRow["status"] | "NONE" = "NONE";
    if (requested === "LEAVE") {
      all.push({ memberId, status: "LEAVE" });
      status = "LEAVE";
    } else if (requested === "JOINED") {
      const joined = all.filter((r) => r.status === "JOINED").length;
      status = cap !== undefined && joined >= cap ? "WAITLISTED" : "JOINED";
      all.push({ memberId, status });
    }
    const promoted = wasJoined && requested !== "JOINED" ? promoteFrom(key, cap) : [];
    const pos = status === "WAITLISTED" ? all.filter((r) => r.status === "WAITLISTED").findIndex((r) => r.memberId === memberId) + 1 : null;
    return { status, waitlistPosition: pos, promoted, backfilled: [], planVersion: 1 };
  }
  function promoteFrom(key: string, cap: number | undefined) {
    const all = list(key);
    const out: string[] = [];
    while (cap !== undefined && all.filter((r) => r.status === "JOINED").length < cap) {
      const next = all.find((r) => r.status === "WAITLISTED");
      if (!next) break;
      next.status = "JOINED";
      out.push(next.memberId);
    }
    return out;
  }

  return {
    puts,
    gets,
    /** seed a row directly (as if another member had acted) */
    seed: (key: string, memberId: string, status: FakeRow["status"], opts2: { placed?: boolean } = {}) => {
      list(key).push({ memberId, status });
      if (opts2.placed) placed.add(`${key}|${memberId}`);
    },
    /** another member unregisters (with promotion), outside the UI */
    externalUnregister: (key: string, eventId: string, memberId: string) => fakeSet(key, eventId, memberId, "NONE"),
  };
}
