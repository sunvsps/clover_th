/**
 * In-browser mock of the Clover_TH backend. Same routes, payloads and error codes as the real API
 * (see docs/backend-design.md), state kept in localStorage so a demo survives refreshes.
 * Enabled with VITE_API_MODE=mock (or localStorage "clover.apiMode" = "mock"); never used against a real backend.
 */
import { seedActivities, seedAdmins, seedEvents, seedJobs, seedLayouts, seedRoster } from "./seed";

type Category = "PET" | "MATERIAL" | "GEMBOX" | "GEAR" | "CARD" | "RELIC";
type QueueCat = "GEAR" | "CARD" | "RELIC";
type Member = { id: string; discordId: string; ign: string; nickname: string | null; jobId: number; isActive: boolean; isAdmin: boolean };
type Job = { id: number; label: string; color: string; sortOrder: number };
type Activity = { id: string; name: string; isGuild: boolean; hasPlanner: boolean; autoBackfill: boolean; registrationCapacity: number | null; notifyChannelId: string | null };
type Team = { id: number; name: string; size: number };
type Room = { id: number; key: string; name: string; teams: Team[] };
type Registration = { memberId: string; status: "JOINED" | "WAITLISTED" | "LEAVE"; registeredAt: number };
type Placement = { memberId: string; teamId: number; slot: number; source: "ADMIN" | "COPY" | "AUTO_BACKFILL"; backfill?: { vacatedMemberId: string | null; reason: string | null; at: string } };
type Plan = { version: number; placements: Placement[] };
type Item = { id: number; name: string; category: Category; rarity: string | null; imageUrl: string | null; winnerId: string | null; wonAt: string | null; queuePos: number | null };
type Round = { id: number; type: "LIVE_CLAIM" | "QUEUE_RANKED"; name: string; status: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED"; durationSec: number; winCap: number | null; startDelaySec: number; opensAt: string | null; closesAt: string | null; items: Item[]; cutoffs: Partial<Record<QueueCat, number>>; sourceRoundId: number | null };
type Audit = { id: number; at: string; actorType: "MEMBER" | "BOT" | "SYSTEM"; actorId: string | null; action: string; entityType: string; entityId: string; meta: unknown; requestId: string | null };
type State = {
  members: Member[];
  jobs: Job[];
  activities: Activity[];
  layouts: Record<string, Room[]>;
  registrations: Record<string, Registration[]>; // "date:eventId"
  plans: Record<string, Plan>;
  rounds: Round[];
  queues: Record<QueueCat, { id: number; memberId: string }[]>;
  prefs: Record<number, Record<string, number[]>>;
  audit: Audit[];
  seq: number;
};

const STORE_KEY = "clover.mock.v2"; // bumped when the seed changes so stale demo state is discarded
const SESSION_KEY = "clover.mock.session";

class MockError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, code: string, message = code, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const uuid = (seedText: string) => {
  // deterministic pseudo-uuid from the seed so ids are stable across reloads
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = (h.toString(16) + "0000000000000000").slice(0, 12) + Math.abs(Math.imul(h, 2654435761)).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${(hex + hex).slice(0, 12)}`;
};

function freshState(): State {
  let seq = 1;
  const members: Member[] = [];
  Object.entries(seedRoster).forEach(([job, names]) =>
    names.forEach((ign, index) => members.push({ id: uuid(ign), discordId: String(800000000000000000n + BigInt(members.length)), ign, nickname: index % 3 === 0 ? null : ign, jobId: Number(job), isActive: true, isAdmin: seedAdmins.includes(ign) })),
  );
  const layouts: Record<string, Room[]> = {};
  Object.entries(seedLayouts).forEach(([activityId, rooms]) => {
    layouts[activityId] = rooms.map((room) => ({ id: seq++, key: room.key, name: room.name, teams: Array.from({ length: room.teams }, (_, t) => ({ id: seq++, name: `Team ${t + 1}`, size: 5 })) }));
  });
  return {
    members,
    jobs: seedJobs.map((job, index) => ({ ...job, sortOrder: index })),
    activities: seedActivities.map((a) => ({ id: a.id, name: a.name, isGuild: a.isGuild ?? false, hasPlanner: a.hasPlanner ?? false, autoBackfill: a.autoBackfill ?? false, registrationCapacity: null, notifyChannelId: null })),
    layouts,
    registrations: {},
    plans: {},
    rounds: [],
    queues: { GEAR: [], CARD: [], RELIC: [] },
    prefs: {},
    audit: [],
    seq,
  };
}

let state: State | null = null;
function load(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    state = raw ? (JSON.parse(raw) as State) : freshState();
  } catch {
    state = freshState();
  }
  return state;
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
export function resetMock() {
  state = freshState();
  save();
  localStorage.removeItem(SESSION_KEY);
}
export const mockSessionMemberId = () => localStorage.getItem(SESSION_KEY);
export function mockLogin(memberId: string) {
  localStorage.setItem(SESSION_KEY, memberId);
}
export const mockMembers = () => load().members.filter((m) => m.isActive).map((m) => ({ id: m.id, ign: m.ign, isAdmin: m.isAdmin, jobId: m.jobId }));

const nowIso = () => new Date().toISOString();
const occurrenceStart = (date: string, start: string) => Date.parse(`${date}T${start}:00+07:00`);
const weekdayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
};

function audit(s: State, actorId: string | null, action: string, entityType: string, entityId: string, meta: unknown = null) {
  s.audit.unshift({ id: s.seq++, at: nowIso(), actorType: actorId ? "MEMBER" : "SYSTEM", actorId, action, entityType, entityId, meta, requestId: null });
  s.audit = s.audit.slice(0, 500);
}

// ---------- helpers ----------
const eventOf = (id: string) => {
  const event = seedEvents.find((e) => e.id === id);
  if (!event) throw new MockError(404, "NOT_FOUND");
  return event;
};
const activityOf = (s: State, id: string) => {
  const activity = s.activities.find((a) => a.id === id);
  if (!activity) throw new MockError(404, "NOT_FOUND");
  return activity;
};
function checkOccurrence(eventId: string, date: string) {
  const event = eventOf(eventId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || weekdayOf(date) !== event.day) throw new MockError(422, "INVALID_OCCURRENCE_DATE");
  return event;
}
const regsOf = (s: State, key: string) => (s.registrations[key] ??= []);
const planOf = (s: State, key: string) => (s.plans[key] ??= { version: 0, placements: [] });
const teamsOf = (s: State, activityId: string) => (s.layouts[activityId] ?? []).flatMap((room) => room.teams.map((team) => ({ ...team, roomId: room.id })));

function reserves(s: State, key: string) {
  const plan = planOf(s, key);
  const placed = new Set(plan.placements.map((p) => p.memberId));
  return regsOf(s, key)
    .filter((r) => r.status === "JOINED" && !placed.has(r.memberId) && s.members.find((m) => m.id === r.memberId)?.isActive)
    .sort((a, b) => a.registeredAt - b.registeredAt)
    .map((r, index) => ({ memberId: r.memberId, registeredAt: new Date(r.registeredAt).toISOString(), order: index + 1 }));
}

function planResponse(s: State, eventId: string, date: string) {
  const event = checkOccurrence(eventId, date);
  const activity = activityOf(s, event.activityId);
  if (!activity.hasPlanner) throw new MockError(404, "ACTIVITY_HAS_NO_PLANNER");
  const key = `${date}:${eventId}`;
  const plan = planOf(s, key);
  const regs = regsOf(s, key);
  const rooms = (s.layouts[activity.id] ?? []).map((room) => ({
    id: room.id,
    key: room.key,
    name: room.name,
    archived: false,
    capacity: room.teams.reduce((sum, team) => sum + team.size, 0),
    teams: room.teams.map((team) => ({
      id: team.id,
      name: team.name,
      size: team.size,
      archived: false,
      placements: plan.placements
        .filter((p) => p.teamId === team.id)
        .map((p) => ({ memberId: p.memberId, slot: p.slot, regStatus: regs.find((r) => r.memberId === p.memberId)?.status ?? "NONE", source: p.source, ...(p.backfill ? { backfill: p.backfill } : {}) })),
    })),
  }));
  return { eventId, date, startsAt: new Date(occurrenceStart(date, event.start)).toISOString(), version: plan.version, autoBackfill: activity.autoBackfill, rooms, reserves: reserves(s, key) };
}

function promoteWaitlist(s: State, key: string, capacity: number | null) {
  const promoted: string[] = [];
  if (capacity === null) return promoted;
  const regs = regsOf(s, key);
  while (regs.filter((r) => r.status === "JOINED").length < capacity) {
    const next = regs.filter((r) => r.status === "WAITLISTED").sort((a, b) => a.registeredAt - b.registeredAt)[0];
    if (!next) break;
    next.status = "JOINED";
    promoted.push(next.memberId);
  }
  return promoted;
}

function backfill(s: State, key: string, activity: Activity, vacatedMemberId: string, reason: string) {
  const plan = planOf(s, key);
  const placement = plan.placements.find((p) => p.memberId === vacatedMemberId);
  if (!placement || !activity.autoBackfill) return [];
  const event = seedEvents.find((e) => e.id === key.split(":")[1])!;
  if (occurrenceStart(key.split(":")[0], event.start) <= Date.now()) return [];
  const next = reserves(s, key)[0];
  plan.placements = plan.placements.filter((p) => p.memberId !== vacatedMemberId);
  if (!next) {
    plan.version += 1;
    return [];
  }
  plan.placements.push({ memberId: next.memberId, teamId: placement.teamId, slot: placement.slot, source: "AUTO_BACKFILL", backfill: { vacatedMemberId, reason, at: nowIso() } });
  plan.version += 1;
  const team = teamsOf(s, activity.id).find((t) => t.id === placement.teamId);
  audit(s, null, "plan.backfill", "occurrence", key, { promotedMemberId: next.memberId, vacatedMemberId });
  return [{ teamId: placement.teamId, teamName: team?.name ?? "", slot: placement.slot, vacatedMemberId, promotedMemberId: next.memberId, reason }];
}

// ---------- auctions ----------
function finalize(s: State, round: Round) {
  if (round.status !== "OPEN" || !round.closesAt || Date.parse(round.closesAt) > Date.now()) return;
  round.status = "CLOSED";
  if (round.type === "QUEUE_RANKED") {
    const snapshot: Record<string, string[]> = {};
    (["GEAR", "CARD", "RELIC"] as QueueCat[]).forEach((cat) => {
      const cutoff = round.cutoffs[cat] ?? -1;
      snapshot[cat] = s.queues[cat].filter((entry) => entry.id <= cutoff).map((entry) => entry.memberId);
    });
    const prefs = s.prefs[round.id] ?? {};
    const winners: Record<QueueCat, string[]> = { GEAR: [], CARD: [], RELIC: [] };
    (["GEAR", "CARD", "RELIC"] as QueueCat[]).forEach((cat) => {
      const free = new Set(round.items.filter((item) => item.category === cat).map((item) => item.id));
      snapshot[cat].forEach((memberId, index) => {
        const list = (prefs[memberId] ?? []).filter((itemId) => round.items.find((item) => item.id === itemId)?.category === cat);
        const pick = list.find((itemId) => free.has(itemId));
        if (pick !== undefined) {
          const item = round.items.find((entry) => entry.id === pick)!;
          item.winnerId = memberId;
          item.wonAt = nowIso();
          item.queuePos = index + 1;
          free.delete(pick);
          winners[cat].push(memberId);
        }
      });
      // requeue winners at the tail in original order
      winners[cat].forEach((memberId) => {
        s.queues[cat] = s.queues[cat].filter((entry) => entry.memberId !== memberId);
        s.queues[cat].push({ id: s.seq++, memberId });
      });
    });
    const leftovers = round.items.filter((item) => !item.winnerId);
    if (leftovers.length) {
      s.rounds.push({ id: s.seq++, type: "LIVE_CLAIM", name: `${round.name} (leftovers)`, status: "DRAFT", durationSec: round.durationSec, winCap: 5, startDelaySec: 3, opensAt: null, closesAt: null, items: leftovers.map((item) => ({ ...item, id: s.seq++, winnerId: null, wonAt: null, queuePos: null })), cutoffs: {}, sourceRoundId: round.id });
    }
  }
  audit(s, null, "auction.round.closed", "round", String(round.id), null);
}
function sweep(s: State) {
  s.rounds.forEach((round) => finalize(s, round));
}
const roundSummary = (round: Round) => ({ id: round.id, type: round.type, name: round.name, status: round.status, durationSec: round.durationSec, winCap: round.winCap, startDelaySec: round.startDelaySec, opensAt: round.opensAt, closesAt: round.closesAt, itemCount: round.items.length });
const itemOut = (item: Item) => ({ id: item.id, name: item.name, category: item.category, rarity: item.rarity, imageUrl: item.imageUrl, winner: item.winnerId ? { memberId: item.winnerId, wonAt: item.wonAt!, queuePos: item.queuePos } : null });
const roundOf = (s: State, id: number) => {
  const round = s.rounds.find((r) => r.id === id);
  if (!round) throw new MockError(404, "NOT_FOUND");
  finalize(s, round);
  return round;
};
const isWindowOpen = (round: Round) => round.status === "OPEN" && !!round.opensAt && !!round.closesAt && Date.parse(round.opensAt) <= Date.now() && Date.now() <= Date.parse(round.closesAt);
const eligibleCategories = (s: State, round: Round, memberId: string) => (["GEAR", "CARD", "RELIC"] as QueueCat[]).filter((cat) => round.cutoffs[cat] !== undefined && s.queues[cat].some((entry) => entry.memberId === memberId && entry.id <= round.cutoffs[cat]!));

// ---------- router ----------
type Ctx = { s: State; me: Member; body: Record<string, unknown>; query: URLSearchParams; params: string[] };
type Handler = (ctx: Ctx) => unknown;
const routes: { method: string; pattern: RegExp; handler: Handler; admin?: boolean }[] = [];
const route = (method: string, path: string, handler: Handler, admin = false) => routes.push({ method, pattern: new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), handler, admin });
const requireAdmin = (me: Member) => {
  if (!me.isAdmin) throw new MockError(403, "ADMIN_REQUIRED");
};

route("GET", "/api/v1/me", ({ s, me }) => ({ memberId: me.id, discordId: me.discordId, ign: me.ign, nickname: me.nickname, job: (({ id, label, color }) => ({ id, label, color }))(s.jobs.find((j) => j.id === me.jobId)!), isAdmin: me.isAdmin, isIncomplete: me.nickname === null, serverTime: nowIso() }));
route("POST", "/api/v1/auth/logout", () => {
  localStorage.removeItem(SESSION_KEY);
  return { ok: true };
});
route("GET", "/api/v1/members", ({ s }) => s.members.filter((m) => m.isActive).map((m) => ({ id: m.id, ign: m.ign, nickname: m.nickname, jobId: m.jobId })));
route("GET", "/api/v1/jobs", ({ s }) => s.jobs.map((job) => ({ ...job, inUse: s.members.some((m) => m.jobId === job.id) })));
route("GET", "/api/v1/activities", ({ s }) => s.activities.map((a) => ({ ...a, layoutCapacity: teamsOf(s, a.id).reduce((sum, t) => sum + t.size, 0) })));
route("GET", "/api/v1/events", ({ s }) => seedEvents.map((e) => ({ id: e.id, activityId: e.activityId, name: activityOf(s, e.activityId).name, isGuild: activityOf(s, e.activityId).isGuild, dayOfWeek: e.day, startTime: e.start, endTime: e.end })));

route("GET", "/api/v1/registrations", ({ s, query }) => {
  const from = query.get("from")!;
  const to = query.get("to")!;
  const occurrences: Record<string, unknown[]> = {};
  Object.entries(s.registrations).forEach(([key, regs]) => {
    const [date, eventId] = key.split(":");
    if (date < from || date > to || regs.length === 0) return;
    const plan = s.plans[key];
    const placed = new Set(plan?.placements.map((p) => p.memberId) ?? []);
    const res = reserves(s, key);
    const waitlist = regs.filter((r) => r.status === "WAITLISTED").sort((a, b) => a.registeredAt - b.registeredAt);
    const hasPlanner = activityOf(s, eventOf(eventId).activityId).hasPlanner;
    occurrences[key] = regs.map((r) => ({
      memberId: r.memberId,
      status: r.status,
      ...(r.status === "WAITLISTED" ? { waitlistPos: waitlist.indexOf(r) + 1 } : {}),
      ...(hasPlanner ? { placed: placed.has(r.memberId), reserveOrder: res.find((x) => x.memberId === r.memberId)?.order ?? null } : {}),
    }));
  });
  return { from, to, serverTime: nowIso(), occurrences };
});
route("PUT", "/api/v1/events/:eventId/occurrences/:date/registrations/:memberId", ({ s, me, body, params }) => {
  const [eventId, date, rawMember] = params;
  const memberId = rawMember === "me" ? me.id : rawMember;
  if (memberId !== me.id) requireAdmin(me);
  const target = s.members.find((m) => m.id === memberId);
  if (!target) throw new MockError(404, "MEMBER_NOT_FOUND");
  if (!target.isActive) throw new MockError(422, "MEMBER_INACTIVE");
  const event = checkOccurrence(eventId, date);
  const activity = activityOf(s, event.activityId);
  if (!me.isAdmin && occurrenceStart(date, event.start) <= Date.now()) throw new MockError(409, "REGISTRATION_CLOSED");
  const status = body.status as "JOINED" | "LEAVE" | "NONE";
  const key = `${date}:${eventId}`;
  const regs = regsOf(s, key);
  const existing = regs.find((r) => r.memberId === memberId);
  const prev = existing?.status ?? "NONE";
  let result: "JOINED" | "WAITLISTED" | "LEAVE" | "NONE" = status;
  let promoted: string[] = [];
  let backfilled: unknown[] = [];
  if (status === "JOINED") {
    if (prev === "JOINED" || prev === "WAITLISTED") result = prev;
    else {
      const joined = regs.filter((r) => r.status === "JOINED").length;
      result = activity.registrationCapacity !== null && joined >= activity.registrationCapacity ? "WAITLISTED" : "JOINED";
      if (existing) {
        existing.status = result;
        existing.registeredAt = Date.now();
      } else regs.push({ memberId, status: result, registeredAt: Date.now() });
    }
  } else {
    if (status === "LEAVE") {
      if (existing) existing.status = "LEAVE";
      else regs.push({ memberId, status: "LEAVE", registeredAt: Date.now() });
    } else s.registrations[key] = regs.filter((r) => r.memberId !== memberId);
    if (prev === "JOINED") {
      promoted = promoteWaitlist(s, key, activity.registrationCapacity);
      backfilled = backfill(s, key, activity, memberId, status);
    }
  }
  audit(s, me.id, "registration.set", "occurrence", key, { memberId, status: result });
  const waitlist = regsOf(s, key).filter((r) => r.status === "WAITLISTED").sort((a, b) => a.registeredAt - b.registeredAt);
  return { status: result, waitlistPosition: result === "WAITLISTED" ? waitlist.findIndex((r) => r.memberId === memberId) + 1 : null, promoted, backfilled, planVersion: planOf(s, key).version };
});

route("GET", "/api/v1/events/:eventId/occurrences/:date/plan", ({ s, params }) => planResponse(s, params[0], params[1]));
route("PUT", "/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId", ({ s, me, body, params }) => {
  requireAdmin(me);
  const [eventId, date, memberId] = params;
  const event = checkOccurrence(eventId, date);
  const activity = activityOf(s, event.activityId);
  if (!activity.hasPlanner) throw new MockError(404, "ACTIVITY_HAS_NO_PLANNER");
  const key = `${date}:${eventId}`;
  const plan = planOf(s, key);
  if (body.expectedVersion !== plan.version) throw new MockError(409, "PLAN_VERSION_CONFLICT", "Stale version", { plan: planResponse(s, eventId, date) });
  const member = s.members.find((m) => m.id === memberId);
  if (!member) throw new MockError(404, "MEMBER_NOT_FOUND");
  if (!member.isActive) throw new MockError(422, "MEMBER_INACTIVE");
  const teamId = body.teamId as number | null;
  const current = plan.placements.find((p) => p.memberId === memberId);
  if (teamId === null) plan.placements = plan.placements.filter((p) => p.memberId !== memberId);
  else {
    const team = teamsOf(s, activity.id).find((t) => t.id === teamId);
    if (!team) throw new MockError(422, "TEAM_NOT_IN_ACTIVITY");
    const inTeam = plan.placements.filter((p) => p.teamId === teamId && p.memberId !== memberId);
    let slot = body.slot as number | undefined;
    if (slot !== undefined && (slot < 1 || slot > team.size)) throw new MockError(422, "SLOT_OUT_OF_RANGE");
    if (slot === undefined) {
      slot = Array.from({ length: team.size }, (_, i) => i + 1).find((n) => !inTeam.some((p) => p.slot === n));
      if (slot === undefined) throw new MockError(409, "TEAM_FULL");
    }
    const occupant = inTeam.find((p) => p.slot === slot);
    if (occupant) {
      if (current) {
        occupant.teamId = current.teamId;
        occupant.slot = current.slot;
      } else plan.placements = plan.placements.filter((p) => p.memberId !== occupant.memberId);
    }
    if (current) {
      current.teamId = teamId;
      current.slot = slot;
      current.source = "ADMIN";
      delete current.backfill;
    } else plan.placements.push({ memberId, teamId, slot, source: "ADMIN" });
  }
  plan.version += 1;
  audit(s, me.id, "plan.placement", "occurrence", key, { memberId, teamId });
  return { version: plan.version };
});
route("POST", "/api/v1/events/:eventId/occurrences/:date/plan/clear", ({ s, me, body, params }) => {
  requireAdmin(me);
  const key = `${params[1]}:${params[0]}`;
  const plan = planOf(s, key);
  if (body.expectedVersion !== plan.version) throw new MockError(409, "PLAN_VERSION_CONFLICT", "Stale version", { plan: planResponse(s, params[0], params[1]) });
  plan.placements = [];
  plan.version += 1;
  audit(s, me.id, "plan.clear", "occurrence", key, null);
  return { version: plan.version };
});
route("POST", "/api/v1/events/:eventId/occurrences/:date/plan/copy-from-previous", ({ s, me, body, params }) => {
  requireAdmin(me);
  const [eventId, date] = params;
  const key = `${date}:${eventId}`;
  const plan = planOf(s, key);
  if (body.expectedVersion !== plan.version) throw new MockError(409, "PLAN_VERSION_CONFLICT", "Stale version", { plan: planResponse(s, eventId, date) });
  if (plan.placements.length) throw new MockError(409, "PLAN_NOT_EMPTY");
  const source = s.plans[`${(body.sourceDate as string | undefined) ?? addDays(date, -7)}:${eventId}`];
  const skipped: { memberId: string; reason: string }[] = [];
  const validTeams = new Set(teamsOf(s, eventOf(eventId).activityId).map((t) => t.id));
  (source?.placements ?? []).forEach((p) => {
    if (!s.members.find((m) => m.id === p.memberId)?.isActive) skipped.push({ memberId: p.memberId, reason: "MEMBER_INACTIVE" });
    else if (!validTeams.has(p.teamId)) skipped.push({ memberId: p.memberId, reason: "TEAM_MISSING" });
    else plan.placements.push({ memberId: p.memberId, teamId: p.teamId, slot: p.slot, source: "COPY" });
  });
  plan.version += 1;
  return { version: plan.version, copied: plan.placements.length, skipped };
});
route("POST", "/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId/undo-backfill", ({ s, me, body, params }) => {
  requireAdmin(me);
  const [eventId, date, memberId] = params;
  const key = `${date}:${eventId}`;
  const plan = planOf(s, key);
  if (body.expectedVersion !== plan.version) throw new MockError(409, "PLAN_VERSION_CONFLICT", "Stale version", { plan: planResponse(s, eventId, date) });
  const placement = plan.placements.find((p) => p.memberId === memberId);
  if (!placement || placement.source !== "AUTO_BACKFILL") throw new MockError(409, "NOT_AN_AUTO_BACKFILL");
  plan.placements = plan.placements.filter((p) => p.memberId !== memberId);
  plan.version += 1;
  return { version: plan.version };
});

const layoutOut = (s: State, activityId: string) => ({ activityId, rooms: (s.layouts[activityId] ?? []).map((room, ri) => ({ id: room.id, key: room.key, name: room.name, sortOrder: ri, capacity: room.teams.reduce((sum, t) => sum + t.size, 0), teams: room.teams.map((t, ti) => ({ ...t, sortOrder: ti })) })) });
route("GET", "/api/v1/admin/activities/:id/layout", ({ s, me, params }) => {
  requireAdmin(me);
  activityOf(s, params[0]);
  return layoutOut(s, params[0]);
});
route("PUT", "/api/v1/admin/activities/:id/layout", ({ s, me, body, params }) => {
  requireAdmin(me);
  const activityId = params[0];
  const rooms = body.rooms as { id?: number; key: string; name: string; teams: { id?: number; name: string; size: number }[] }[];
  const placed = Object.entries(s.plans).filter(([key]) => eventOf(key.split(":")[1]).activityId === activityId).flatMap(([, plan]) => plan.placements);
  const next: Room[] = rooms.map((room) => ({ id: room.id ?? s.seq++, key: room.key, name: room.name, teams: room.teams.map((team) => ({ id: team.id ?? s.seq++, name: team.name, size: team.size })) }));
  const nextTeams = new Map(next.flatMap((r) => r.teams).map((t) => [t.id, t]));
  const orphan = placed.find((p) => !nextTeams.has(p.teamId) || p.slot > nextTeams.get(p.teamId)!.size);
  if (orphan) throw new MockError(409, "LAYOUT_BELOW_PLACED", "Members placed", { teamId: orphan.teamId });
  s.layouts[activityId] = next;
  return layoutOut(s, activityId);
});

route("GET", "/api/v1/auctions/rounds", ({ s, query }) => {
  sweep(s);
  const status = query.get("status");
  return { serverTime: nowIso(), rounds: [...s.rounds].filter((r) => !status || r.status === status).sort((a, b) => b.id - a.id).map(roundSummary) };
});
route("GET", "/api/v1/auctions/rounds/:id", ({ s, me, params }) => {
  const round = roundOf(s, Number(params[0]));
  return { ...roundSummary(round), items: round.items.map(itemOut), serverTime: nowIso(), myWinCount: round.items.filter((i) => i.winnerId === me.id).length, eligibleCategories: eligibleCategories(s, round, me.id) };
});
route("POST", "/api/v1/auctions/rounds/:id/items/:itemId/claim", ({ s, me, params }) => {
  const round = roundOf(s, Number(params[0]));
  if (round.type !== "LIVE_CLAIM") throw new MockError(409, "ROUND_TYPE_MISMATCH");
  if (!isWindowOpen(round)) throw new MockError(409, round.status === "CLOSED" ? "ROUND_CLOSED" : "ROUND_NOT_OPEN");
  const item = round.items.find((i) => i.id === Number(params[1]));
  if (!item) throw new MockError(404, "NOT_FOUND");
  const mine = round.items.filter((i) => i.winnerId === me.id).length;
  if (item.winnerId === me.id) return { item: itemOut(item), myWinCount: mine };
  if (mine >= (round.winCap ?? 5)) throw new MockError(409, "CLAIM_CAP_REACHED");
  if (item.winnerId) throw new MockError(409, "ITEM_ALREADY_CLAIMED", "Already claimed", { winnerId: item.winnerId });
  item.winnerId = me.id;
  item.wonAt = nowIso();
  audit(s, me.id, "auction.claim", "item", String(item.id), null);
  return { item: itemOut(item), myWinCount: mine + 1 };
});
route("DELETE", "/api/v1/auctions/rounds/:id/items/:itemId/claim", ({ s, me, params }) => {
  const round = roundOf(s, Number(params[0]));
  if (!isWindowOpen(round)) throw new MockError(409, "ROUND_CLOSED");
  const item = round.items.find((i) => i.id === Number(params[1]));
  if (!item) throw new MockError(404, "NOT_FOUND");
  if (item.winnerId !== me.id) throw new MockError(403, "NOT_YOUR_CLAIM");
  item.winnerId = null;
  item.wonAt = null;
  return { item: itemOut(item), myWinCount: round.items.filter((i) => i.winnerId === me.id).length };
});
route("GET", "/api/v1/auctions/rounds/:id/results", ({ s, params }) => {
  const round = roundOf(s, Number(params[0]));
  if (round.status !== "CLOSED") throw new MockError(409, "ROUND_NOT_OPEN");
  return { roundId: round.id, status: "CLOSED", closedAt: round.closesAt, serverTime: nowIso(), items: round.items.map(itemOut), leftoverRoundId: s.rounds.find((r) => r.sourceRoundId === round.id)?.id ?? null };
});
route("GET", "/api/v1/auctions/rounds/:id/results/me", ({ s, me, params }) => {
  const round = roundOf(s, Number(params[0]));
  return { roundId: round.id, status: round.status, serverTime: nowIso(), items: round.items.filter((i) => i.winnerId === me.id).map(itemOut), myWinCount: round.items.filter((i) => i.winnerId === me.id).length };
});
const queueOut = (s: State, cat: QueueCat, me: Member) => ({ category: cat, length: s.queues[cat].length, myRank: (() => { const index = s.queues[cat].findIndex((e) => e.memberId === me.id); return index < 0 ? null : index + 1; })(), entries: s.queues[cat].map((e, i) => ({ rank: i + 1, memberId: e.memberId })) });
route("GET", "/api/v1/auctions/queues", ({ s, me }) => (["GEAR", "CARD", "RELIC"] as QueueCat[]).map((cat) => queueOut(s, cat, me)));
route("PUT", "/api/v1/auctions/queues/:category/me", ({ s, me, params }) => {
  const cat = params[0] as QueueCat;
  if (!["GEAR", "CARD", "RELIC"].includes(cat)) throw new MockError(422, "INVALID_QUEUE_CATEGORY");
  if (!s.queues[cat].some((e) => e.memberId === me.id)) s.queues[cat].push({ id: s.seq++, memberId: me.id });
  return queueOut(s, cat, me);
});
route("DELETE", "/api/v1/auctions/queues/:category/me", ({ s, me, params }) => {
  const cat = params[0] as QueueCat;
  if (!["GEAR", "CARD", "RELIC"].includes(cat)) throw new MockError(422, "INVALID_QUEUE_CATEGORY");
  s.queues[cat] = s.queues[cat].filter((e) => e.memberId !== me.id);
  return queueOut(s, cat, me);
});
route("GET", "/api/v1/auctions/rounds/:id/preferences/me", ({ s, me, params }) => ({ roundId: Number(params[0]), itemIds: s.prefs[Number(params[0])]?.[me.id] ?? [] }));
route("PUT", "/api/v1/auctions/rounds/:id/preferences/me", ({ s, me, body, params }) => {
  const round = roundOf(s, Number(params[0]));
  if (round.type !== "QUEUE_RANKED") throw new MockError(409, "ROUND_TYPE_MISMATCH");
  if (!isWindowOpen(round)) throw new MockError(409, round.status === "CLOSED" ? "ROUND_CLOSED" : "ROUND_NOT_OPEN");
  const itemIds = body.itemIds as number[];
  if (new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !round.items.find((i) => i.id === id))) throw new MockError(422, "INVALID_PREFERENCE_LIST");
  const eligible = eligibleCategories(s, round, me.id);
  if (itemIds.some((id) => !eligible.includes(round.items.find((i) => i.id === id)!.category as QueueCat))) throw new MockError(409, "NOT_ELIGIBLE_FOR_CATEGORY");
  (s.prefs[round.id] ??= {})[me.id] = itemIds;
  return { roundId: round.id, itemIds };
});

// admin
route("GET", "/api/v1/admin/members", ({ s, me, query }) => {
  requireAdmin(me);
  const inactive = ["1", "true"].includes(query.get("includeInactive") ?? "");
  const incomplete = ["1", "true"].includes(query.get("incomplete") ?? "");
  return s.members.filter((m) => (inactive || m.isActive) && (!incomplete || m.nickname === null)).map((m) => ({ ...m, isIncomplete: m.nickname === null }));
});
route("PATCH", "/api/v1/admin/members/:id", ({ s, me, body, params }) => {
  requireAdmin(me);
  const member = s.members.find((m) => m.id === params[0]);
  if (!member) throw new MockError(404, "MEMBER_NOT_FOUND");
  if (typeof body.ign === "string") {
    const ign = body.ign.normalize("NFC").trim();
    if (s.members.some((m) => m.id !== member.id && m.isActive && m.ign.toLowerCase() === ign.toLowerCase())) throw new MockError(409, "DUPLICATE_IGN");
    member.ign = ign;
  }
  if (body.nickname !== undefined) member.nickname = (body.nickname as string | null) || null;
  if (typeof body.jobId === "number") {
    if (!s.jobs.find((j) => j.id === body.jobId)) throw new MockError(422, "INVALID_JOB");
    member.jobId = body.jobId;
  }
  audit(s, me.id, "member.update", "member", member.id, body);
  return { ...member, isIncomplete: member.nickname === null };
});
route("POST", "/api/v1/admin/members/:id/deactivate", ({ s, me, params }) => {
  requireAdmin(me);
  if (params[0] === me.id) throw new MockError(409, "CANNOT_DEACTIVATE_SELF");
  const member = s.members.find((m) => m.id === params[0]);
  if (!member) throw new MockError(404, "MEMBER_NOT_FOUND");
  member.isActive = false;
  (["GEAR", "CARD", "RELIC"] as QueueCat[]).forEach((cat) => (s.queues[cat] = s.queues[cat].filter((e) => e.memberId !== member.id)));
  audit(s, me.id, "member.deactivate", "member", member.id, null);
  return { ...member, isIncomplete: member.nickname === null };
});
route("POST", "/api/v1/admin/members/:id/reactivate", ({ s, me, params }) => {
  requireAdmin(me);
  const member = s.members.find((m) => m.id === params[0]);
  if (!member) throw new MockError(404, "MEMBER_NOT_FOUND");
  if (s.members.some((m) => m.id !== member.id && m.isActive && m.ign.toLowerCase() === member.ign.toLowerCase())) throw new MockError(409, "DUPLICATE_IGN");
  member.isActive = true;
  return { ...member, isIncomplete: member.nickname === null };
});
route("PUT", "/api/v1/admin/jobs", ({ s, me, body }) => {
  requireAdmin(me);
  const incoming = body.jobs as { id?: number; label: string; color: string; sortOrder?: number }[];
  const labels = incoming.map((j) => j.label.normalize("NFC").trim().toLowerCase());
  if (new Set(labels).size !== labels.length) throw new MockError(409, "DUPLICATE_JOB_LABEL");
  const keep = new Set(incoming.filter((j) => j.id).map((j) => j.id));
  const removed = s.jobs.filter((j) => !keep.has(j.id));
  if (removed.some((j) => s.members.some((m) => m.jobId === j.id))) throw new MockError(409, "JOB_IN_USE");
  s.jobs = incoming.map((j, index) => ({ id: j.id ?? s.seq++, label: j.label.trim(), color: j.color, sortOrder: j.sortOrder ?? index }));
  audit(s, me.id, "jobs.replace", "job", "*", null);
  return s.jobs.map((job) => ({ ...job, inUse: s.members.some((m) => m.jobId === job.id) }));
});
route("PATCH", "/api/v1/admin/activities/:id", ({ s, me, body, params }) => {
  requireAdmin(me);
  const activity = activityOf(s, params[0]);
  if (body.autoBackfill === true && !activity.hasPlanner) throw new MockError(422, "AUTO_BACKFILL_REQUIRES_PLANNER");
  if (body.registrationCapacity !== undefined) activity.registrationCapacity = body.registrationCapacity as number | null;
  if (body.autoBackfill !== undefined) activity.autoBackfill = body.autoBackfill as boolean;
  if (body.notifyChannelId !== undefined) activity.notifyChannelId = body.notifyChannelId as string | null;
  const promoted: { occurrenceId: number; memberId: string }[] = [];
  Object.entries(s.registrations).forEach(([key]) => {
    if (eventOf(key.split(":")[1]).activityId === activity.id) promoteWaitlist(s, key, activity.registrationCapacity).forEach((memberId) => promoted.push({ occurrenceId: 0, memberId }));
  });
  return { activity: { ...activity, layoutCapacity: teamsOf(s, activity.id).reduce((sum, t) => sum + t.size, 0) }, promoted };
});
const draftOnly = (round: Round) => {
  if (round.status !== "DRAFT") throw new MockError(409, "ROUND_NOT_DRAFT");
};
const itemsFromBody = (s: State, items: { name: string; category: Category; rarity?: string | null; imageUrl?: string | null }[]) => items.map((item) => ({ id: s.seq++, name: item.name, category: item.category, rarity: item.rarity ?? null, imageUrl: item.imageUrl ?? null, winnerId: null, wonAt: null, queuePos: null }));
route("POST", "/api/v1/admin/auctions/rounds", ({ s, me, body }) => {
  requireAdmin(me);
  const type = body.type as Round["type"];
  const items = (body.items as Parameters<typeof itemsFromBody>[1] | undefined) ?? [];
  if (type === "QUEUE_RANKED" && items.some((i) => !["GEAR", "CARD", "RELIC"].includes(i.category))) throw new MockError(422, "INVALID_CATEGORY_FOR_TYPE");
  const round: Round = { id: s.seq++, type, name: body.name as string, status: "DRAFT", durationSec: (body.durationSec as number) ?? 300, winCap: type === "LIVE_CLAIM" ? ((body.winCap as number) ?? 5) : null, startDelaySec: (body.startDelaySec as number) ?? 3, opensAt: null, closesAt: null, items: itemsFromBody(s, items), cutoffs: {}, sourceRoundId: null };
  s.rounds.push(round);
  audit(s, me.id, "auction.round.create", "round", String(round.id), null);
  return { ...roundSummary(round), items: round.items.map(itemOut) };
});
route("PATCH", "/api/v1/admin/auctions/rounds/:id", ({ s, me, body, params }) => {
  requireAdmin(me);
  const round = roundOf(s, Number(params[0]));
  draftOnly(round);
  if (typeof body.name === "string") round.name = body.name;
  if (typeof body.durationSec === "number") round.durationSec = body.durationSec;
  if (typeof body.winCap === "number") round.winCap = body.winCap;
  if (Array.isArray(body.items)) round.items = itemsFromBody(s, body.items as never);
  return { ...roundSummary(round), items: round.items.map(itemOut) };
});
route("POST", "/api/v1/admin/auctions/rounds/:id/start", ({ s, me, body, params }) => {
  requireAdmin(me);
  sweep(s);
  const round = roundOf(s, Number(params[0]));
  draftOnly(round);
  if (round.items.length === 0) throw new MockError(409, "ROUND_EMPTY");
  if (s.rounds.some((r) => r.type === round.type && r.status === "OPEN")) throw new MockError(409, "ANOTHER_ROUND_OPEN");
  const delay = (body.startDelaySec as number | undefined) ?? round.startDelaySec;
  const duration = (body.durationSec as number | undefined) ?? round.durationSec;
  const opens = Date.now() + delay * 1000;
  round.opensAt = new Date(opens).toISOString();
  round.closesAt = new Date(opens + duration * 1000).toISOString();
  round.status = "OPEN";
  if (round.type === "QUEUE_RANKED") (["GEAR", "CARD", "RELIC"] as QueueCat[]).forEach((cat) => { if (round.items.some((i) => i.category === cat)) round.cutoffs[cat] = s.queues[cat].at(-1)?.id ?? 0; });
  audit(s, me.id, "auction.round.start", "round", String(round.id), null);
  return { ...roundSummary(round), items: round.items.map(itemOut) };
});
route("POST", "/api/v1/admin/auctions/rounds/:id/close", ({ s, me, params }) => {
  requireAdmin(me);
  const round = roundOf(s, Number(params[0]));
  if (round.status !== "OPEN") throw new MockError(409, "ROUND_NOT_OPEN");
  round.closesAt = nowIso();
  finalize(s, round);
  return { ...roundSummary(round), items: round.items.map(itemOut) };
});
route("POST", "/api/v1/admin/auctions/rounds/:id/cancel", ({ s, me, params }) => {
  requireAdmin(me);
  const round = roundOf(s, Number(params[0]));
  if (round.status === "CLOSED" || round.status === "CANCELLED") throw new MockError(409, "CONFLICT");
  round.status = "CANCELLED";
  return { ...roundSummary(round), items: round.items.map(itemOut) };
});
route("GET", "/api/v1/admin/auctions/rounds/:id/preferences", ({ s, me, params }) => {
  requireAdmin(me);
  return { roundId: Number(params[0]), lists: Object.entries(s.prefs[Number(params[0])] ?? {}).map(([memberId, itemIds]) => ({ memberId, itemIds })) };
});
route("GET", "/api/v1/admin/notifications", ({ me }) => {
  requireAdmin(me);
  return { items: [], counts: { PENDING: 0, SENDING: 0, SENT: 0, DEAD: 0 }, nextCursor: null };
});
route("POST", "/api/v1/admin/notifications/:id/retry", ({ me }) => {
  requireAdmin(me);
  throw new MockError(404, "NOT_FOUND");
});
route("GET", "/api/v1/admin/audit-log", ({ s, me, query }) => {
  requireAdmin(me);
  return { items: s.audit.slice(0, Number(query.get("limit") ?? 100)), nextCursor: null };
});

export async function mockRequest(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 80)); // feel like a network
  const s = load();
  const [path, qs = ""] = url.split("?");
  const query = new URLSearchParams(qs);
  const entry = routes.find((r) => r.method === method.toUpperCase() && r.pattern.test(path));
  if (!entry) return { status: 404, body: { error: { code: "NOT_FOUND", message: `No mock route for ${method} ${path}` } } };
  const memberId = mockSessionMemberId();
  const me = s.members.find((m) => m.id === memberId);
  if (!me) return { status: 401, body: { error: { code: "AUTH_REQUIRED", message: "Sign in first" } } };
  if (!me.isActive) return { status: 403, body: { error: { code: "AUTH_MEMBER_INACTIVE", message: "Inactive" } } };
  const params = path.match(entry.pattern)!.slice(1).map(decodeURIComponent);
  try {
    const result = entry.handler({ s, me, body: (body as Record<string, unknown>) ?? {}, query, params });
    save();
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof MockError) return { status: error.status, body: { error: { code: error.code, message: error.message, details: error.details } } };
    throw error;
  }
}
