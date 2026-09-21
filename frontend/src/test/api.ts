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
    http.get("*/api/v1/auctions/rounds", () => HttpResponse.json({ serverTime: new Date().toISOString(), rounds: [] })),
    http.get("*/api/v1/auctions/queues", () => HttpResponse.json([])),
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

type PlanRegStatus = "JOINED" | "WAITLISTED" | "LEAVE" | "NONE";
type FakePlacement = { memberId: string; teamId: number; slot: number; source: "ADMIN" | "COPY" | "AUTO_BACKFILL"; vacated?: string; at?: string };
export type FakeLayout = { name: string; teams: number; size?: number; archived?: boolean }[];

/**
 * In-memory stand-in for the planner API of ONE occurrence (GET plan, PUT placement, clear, copy, undo-backfill),
 * with the real version rule (409 PLAN_VERSION_CONFLICT carrying the current plan). Registered members that are not
 * placed are the reserves, in registration order.
 */
export function fakePlanner(opts: { me: Me; layout: FakeLayout; registered?: string[]; autoBackfill?: boolean }) {
  let version = 0;
  let nextTeamId = 1;
  const rooms = opts.layout.map((r, i) => ({
    id: i + 1,
    key: r.name.toLowerCase(),
    name: r.name,
    archived: false,
    teams: Array.from({ length: r.teams }, (_, n) => ({ id: nextTeamId++, name: `${r.name} ${n + 1}`, size: r.size ?? 5, archived: r.archived ?? false })),
  }));
  const registered = [...(opts.registered ?? [])];
  const regOf = new Map<string, PlanRegStatus>(registered.map((id) => [id, "JOINED"]));
  let placements: FakePlacement[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  const teams = () => rooms.flatMap((r) => r.teams);

  const wirePlan = () => ({
    eventId: "e", date: "d", startsAt: null, version, autoBackfill: opts.autoBackfill ?? false,
    rooms: rooms.map((r) => ({
      id: r.id, key: r.key, name: r.name, archived: false,
      capacity: r.teams.filter((t) => !t.archived).reduce((n, t) => n + t.size, 0),
      teams: r.teams.map((t) => ({
        id: t.id, name: t.name, size: t.size, archived: t.archived,
        placements: placements.filter((p) => p.teamId === t.id).sort((a, b) => a.slot - b.slot).map((p) => ({
          memberId: p.memberId, slot: p.slot, regStatus: regOf.get(p.memberId) ?? "NONE", source: p.source,
          ...(p.source === "AUTO_BACKFILL" ? { backfill: { vacatedMemberId: p.vacated ?? null, reason: "UNREGISTERED", at: p.at ?? "2026-09-22T10:00:00Z" } } : {}),
        })),
      })),
    })),
    reserves: registered.filter((id) => regOf.get(id) === "JOINED" && !placements.some((p) => p.memberId === id)).map((id, i) => ({ memberId: id, registeredAt: "2026-09-21T00:00:00Z", order: i + 1 })),
  });
  const err = (code: string, status: number, details: Record<string, unknown> = {}) => HttpResponse.json({ error: { code, message: code, details } }, { status });

  const guard = (body: { expectedVersion: number }) => {
    if (!opts.me.isAdmin) return err("ADMIN_REQUIRED", 403);
    if (body.expectedVersion !== version) return err("PLAN_VERSION_CONFLICT", 409, { currentVersion: version, plan: wirePlan() });
    return null;
  };

  server.use(
    http.get("*/api/v1/events/:eventId/occurrences/:date/plan", ({ params, request }) => {
      calls.push({ method: "GET", path: new URL(request.url).pathname, body: null });
      return HttpResponse.json({ ...wirePlan(), eventId: String(params.eventId), date: String(params.date) });
    }),
    http.put("*/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId", async ({ request, params }) => {
      const body = (await request.json()) as { teamId: number | null; slot?: number; expectedVersion: number };
      calls.push({ method: "PUT", path: new URL(request.url).pathname, body });
      const bad = guard(body);
      if (bad) return bad;
      const memberId = String(params.memberId);
      const cur = placements.find((p) => p.memberId === memberId);
      if (body.teamId === null) {
        if (cur) { placements = placements.filter((p) => p !== cur); version++; }
        return HttpResponse.json({ version });
      }
      const team = teams().find((t) => t.id === body.teamId);
      if (!team) return err("NOT_FOUND", 404);
      let slot = body.slot;
      if (slot === undefined) {
        const used = new Set(placements.filter((p) => p.teamId === team.id).map((p) => p.slot));
        slot = Array.from({ length: team.size }, (_, i) => i + 1).find((s) => !used.has(s));
        if (slot === undefined) return err("TEAM_FULL", 409);
      }
      const occupant = placements.find((p) => p.teamId === team.id && p.slot === slot);
      placements = placements.filter((p) => p !== cur && p !== occupant);
      placements.push({ memberId, teamId: team.id, slot, source: "ADMIN" });
      if (occupant && cur) placements.push({ memberId: occupant.memberId, teamId: cur.teamId, slot: cur.slot, source: "ADMIN" });
      version++;
      return HttpResponse.json({ version });
    }),
    http.post("*/api/v1/events/:eventId/occurrences/:date/plan/clear", async ({ request }) => {
      const body = (await request.json()) as { expectedVersion: number };
      calls.push({ method: "POST", path: new URL(request.url).pathname, body });
      const bad = guard(body);
      if (bad) return bad;
      const removed = placements.length;
      placements = [];
      if (removed) version++;
      return HttpResponse.json({ version, removed });
    }),
    http.post("*/api/v1/events/:eventId/occurrences/:date/plan/copy-from-previous", async ({ request }) => {
      const body = (await request.json()) as { expectedVersion: number };
      calls.push({ method: "POST", path: new URL(request.url).pathname, body });
      const bad = guard(body);
      if (bad) return bad;
      return HttpResponse.json({ copied: 3, skipped: [{ memberId: "x", reason: "MEMBER_INACTIVE" }], version, sourceDate: "2026-09-15" });
    }),
    http.post("*/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId/undo-backfill", async ({ request, params }) => {
      const body = (await request.json()) as { expectedVersion: number };
      calls.push({ method: "POST", path: new URL(request.url).pathname, body });
      const bad = guard(body);
      if (bad) return bad;
      placements = placements.filter((p) => p.memberId !== String(params.memberId));
      version++;
      return HttpResponse.json({ version, cancelledNotifications: 0 });
    }),
  );

  return {
    calls,
    teamId: (name: string) => teams().find((t) => t.name === name)!.id,
    get version() { return version; },
    /** place someone directly (as if an admin had done it earlier) */
    seedPlacement: (memberId: string, teamName: string, slot: number, reg: PlanRegStatus = "JOINED") => {
      placements.push({ memberId, teamId: teams().find((t) => t.name === teamName)!.id, slot, source: "ADMIN" });
      regOf.set(memberId, reg);
      if (reg === "JOINED" && !registered.includes(memberId)) registered.push(memberId);
    },
    /** someone else's change: the version moves without this client knowing */
    externalPlace: (memberId: string, teamName: string, slot: number) => {
      placements.push({ memberId, teamId: teams().find((t) => t.name === teamName)!.id, slot, source: "ADMIN" });
      version++;
    },
    /** a placed member unregisters and the first reserve is auto-placed into the vacated slot */
    externalBackfill: (vacated: string, promoted: string) => {
      const p = placements.find((x) => x.memberId === vacated)!;
      placements = placements.filter((x) => x !== p);
      registered.splice(registered.indexOf(vacated), 1);
      regOf.delete(vacated);
      placements.push({ memberId: promoted, teamId: p.teamId, slot: p.slot, source: "AUTO_BACKFILL", vacated, at: "2026-09-22T11:00:00Z" });
      version++;
    },
  };
}

export type FakeItem = { id: number; name: string; category: "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC"; winner?: string; queuePos?: number };
export type FakeRound = {
  id: number;
  type: "LIVE_CLAIM" | "QUEUE_RANKED";
  name: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
  opensAt?: string;
  closesAt?: string;
  winCap?: number;
  items: FakeItem[];
  eligible?: string[];
  leftoverRoundId?: number;
};

/**
 * In-memory stand-in for the auction API (rounds with ETag/304, claim/release with the real error codes, results,
 * queues, own preferences). `serverNow` is the server's clock; the browser clock may be set to anything else.
 */
export function fakeAuctions(opts: { me: Me; rounds: FakeRound[]; serverNow: () => number; queues?: Record<string, string[]> }) {
  const rounds = new Map(opts.rounds.map((r) => [r.id, r]));
  const queues: Record<string, string[]> = { GEAR: [], CARD: [], RELIC: [], ...opts.queues };
  const prefs = new Map<number, number[]>();
  let version = 1;
  let rateLimitNext = false;
  const calls: { method: string; path: string; body?: unknown; ifNoneMatch?: string | null }[] = [];
  const err = (code: string, status: number, details: Record<string, unknown> = {}, headers?: Record<string, string>) =>
    HttpResponse.json({ error: { code, message: code, details } }, { status, headers });
  const stamp = () => ({ "X-Server-Time": new Date(opts.serverNow()).toISOString() });
  const wireItem = (i: FakeItem) => ({ id: i.id, name: i.name, category: i.category, rarity: null, imageUrl: null, winner: i.winner ? { memberId: i.winner, wonAt: "2026-09-21T10:00:00Z", queuePos: i.queuePos ?? null } : null });
  const summary = (r: FakeRound) => ({
    id: r.id, type: r.type, name: r.name, status: r.status, durationSec: 300, winCap: r.type === "LIVE_CLAIM" ? (r.winCap ?? 5) : null,
    startDelaySec: 3, opensAt: r.opensAt ?? null, closesAt: r.closesAt ?? null,
  });
  const isOpenWindow = (r: FakeRound) => r.status === "OPEN" && (!r.opensAt || opts.serverNow() >= Date.parse(r.opensAt)) && (!r.closesAt || opts.serverNow() < Date.parse(r.closesAt));
  const mine = (r: FakeRound) => r.items.filter((i) => i.winner === opts.me.memberId);
  const visible = (r?: FakeRound) => (r && (opts.me.isAdmin || r.status !== "DRAFT") ? r : undefined);

  server.use(
    http.get("*/api/v1/auctions/rounds", () =>
      HttpResponse.json({ serverTime: new Date(opts.serverNow()).toISOString(), rounds: [...rounds.values()].filter((r) => visible(r)).map((r) => ({ ...summary(r), itemCount: r.items.length })).reverse() }, { headers: stamp() }),
    ),
    http.get("*/api/v1/auctions/rounds/:id", ({ request, params }) => {
      const r = visible(rounds.get(Number(params.id)));
      const inm = request.headers.get("if-none-match");
      calls.push({ method: "GET", path: new URL(request.url).pathname, ifNoneMatch: inm });
      if (!r) return err("NOT_FOUND", 404);
      const etag = `"v${version}-${opts.me.memberId}-${r.status}"`;
      if (inm === etag) return new HttpResponse(null, { status: 304, headers: { ...stamp(), ETag: etag } });
      return HttpResponse.json(
        { ...summary(r), serverTime: new Date(opts.serverNow()).toISOString(), items: r.items.map(wireItem), myWinCount: mine(r).length, eligibleCategories: r.type === "QUEUE_RANKED" ? (r.eligible ?? []) : [] },
        { headers: { ...stamp(), ETag: etag } },
      );
    }),
    http.post("*/api/v1/auctions/rounds/:id/items/:itemId/claim", ({ request, params }) => {
      calls.push({ method: "POST", path: new URL(request.url).pathname });
      if (rateLimitNext) { rateLimitNext = false; return err("RATE_LIMITED", 429, {}, { "Retry-After": "2" }); }
      const r = rounds.get(Number(params.id))!;
      if (!isOpenWindow(r)) return err("ROUND_CLOSED", 409);
      const item = r.items.find((i) => i.id === Number(params.itemId));
      if (!item) return err("NOT_FOUND", 404);
      if (item.winner === opts.me.memberId) return HttpResponse.json({ item: wireItem(item), myWinCount: mine(r).length });
      if (mine(r).length >= (r.winCap ?? 5)) return err("CLAIM_CAP_REACHED", 409, { winCap: r.winCap ?? 5 });
      if (item.winner) return err("ITEM_ALREADY_CLAIMED", 409, { winner: wireItem(item).winner });
      item.winner = opts.me.memberId;
      version++;
      return HttpResponse.json({ item: wireItem(item), myWinCount: mine(r).length });
    }),
    http.delete("*/api/v1/auctions/rounds/:id/items/:itemId/claim", ({ request, params }) => {
      calls.push({ method: "DELETE", path: new URL(request.url).pathname });
      const r = rounds.get(Number(params.id))!;
      const item = r.items.find((i) => i.id === Number(params.itemId))!;
      if (item.winner && item.winner !== opts.me.memberId) return err("NOT_YOUR_CLAIM", 403);
      item.winner = undefined;
      version++;
      return HttpResponse.json({ item: wireItem(item), myWinCount: mine(r).length });
    }),
    http.get("*/api/v1/auctions/rounds/:id/results", ({ params }) => {
      const r = visible(rounds.get(Number(params.id)));
      if (!r) return err("NOT_FOUND", 404);
      if (r.status !== "CLOSED") return err("ROUND_NOT_CLOSED", 409);
      return HttpResponse.json({ roundId: r.id, status: "CLOSED", closedAt: "2026-09-21T10:05:00Z", serverTime: new Date(opts.serverNow()).toISOString(), items: r.items.map(wireItem), leftoverRoundId: r.leftoverRoundId ?? null });
    }),
    http.get("*/api/v1/auctions/rounds/:id/results/me", ({ params }) => {
      const r = rounds.get(Number(params.id))!;
      return HttpResponse.json({ roundId: r.id, status: r.status, serverTime: new Date(opts.serverNow()).toISOString(), items: mine(r).map(wireItem), myWinCount: mine(r).length });
    }),
    http.get("*/api/v1/auctions/queues", () =>
      HttpResponse.json(
        Object.entries(queues).map(([category, ids]) => ({ category, length: ids.length, myRank: ids.indexOf(opts.me.memberId) >= 0 ? ids.indexOf(opts.me.memberId) + 1 : null, entries: ids.map((memberId, i) => ({ rank: i + 1, memberId })) })),
      ),
    ),
    http.put("*/api/v1/auctions/queues/:category/me", ({ params, request }) => {
      calls.push({ method: "PUT", path: new URL(request.url).pathname });
      const q = queues[String(params.category)]!;
      if (!q.includes(opts.me.memberId)) q.push(opts.me.memberId);
      return HttpResponse.json({ category: params.category, length: q.length, myRank: q.indexOf(opts.me.memberId) + 1 });
    }),
    http.delete("*/api/v1/auctions/queues/:category/me", ({ params, request }) => {
      calls.push({ method: "DELETE", path: new URL(request.url).pathname });
      const q = queues[String(params.category)]!;
      const i = q.indexOf(opts.me.memberId);
      if (i >= 0) q.splice(i, 1);
      return HttpResponse.json({ category: params.category, length: q.length, myRank: null });
    }),
    http.get("*/api/v1/auctions/rounds/:id/preferences/me", ({ params }) => HttpResponse.json({ roundId: Number(params.id), itemIds: prefs.get(Number(params.id)) ?? [] })),
    http.put("*/api/v1/auctions/rounds/:id/preferences/me", async ({ params, request }) => {
      const body = (await request.json()) as { itemIds: number[] };
      calls.push({ method: "PUT", path: new URL(request.url).pathname, body });
      const r = rounds.get(Number(params.id))!;
      if (r.status !== "OPEN") return err("ROUND_CLOSED", 409);
      for (const id of body.itemIds) {
        const item = r.items.find((i) => i.id === id);
        if (!item) return err("INVALID_PREFERENCE_LIST", 422);
        if (!(r.eligible ?? []).includes(item.category)) return err("NOT_ELIGIBLE_FOR_CATEGORY", 409, { category: item.category });
      }
      prefs.set(r.id, body.itemIds);
      return HttpResponse.json({ roundId: r.id, itemIds: body.itemIds });
    }),
  );

  return {
    calls,
    prefs,
    /** another member claims an item behind this client's back */
    claimBy: (roundId: number, itemId: number, memberId: string) => { rounds.get(roundId)!.items.find((i) => i.id === itemId)!.winner = memberId; version++; },
    /** the round closes with these winners (itemId -> memberId, queuePos) */
    close: (roundId: number, winners: Record<number, { memberId: string; queuePos?: number }> = {}) => {
      const r = rounds.get(roundId)!;
      r.status = "CLOSED";
      for (const [id, w] of Object.entries(winners)) { const it = r.items.find((i) => i.id === Number(id))!; it.winner = w.memberId; it.queuePos = w.queuePos; }
      version++;
    },
    setQueue: (category: string, ids: string[]) => { queues[category] = ids; },
    rateLimitNext: () => { rateLimitNext = true; },
  };
}
