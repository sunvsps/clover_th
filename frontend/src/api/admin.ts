import { get, patch, post, put } from "./client";
import type { paths } from "./schema";
import type { Job, GuildMember } from "../data/guild";
import type { Category, RoundStatus, RoundSummary } from "./auctions";

/**
 * Admin endpoints (every call needs an admin session; the server enforces it with ADMIN_REQUIRED). There is
 * deliberately NO call here to grant admin or to add or delete a member: the design forbids them.
 */
type Ok<P extends keyof paths, M extends "get" | "put" | "post" | "patch"> = paths[P] extends Record<M, infer Op>
  ? Op extends { responses: { 200: { content: { "application/json": infer B } } } }
    ? B
    : Op extends { responses: { 201: { content: { "application/json": infer B } } } }
      ? B
      : never
  : never;

// ---------- members ----------
type WireAdminMember = Ok<"/api/v1/admin/members", "get">[number];
export type AdminMember = {
  id: string;
  ign: string;
  nickname: string | null;
  job: number;
  discordId: string;
  isActive: boolean;
  /** read-only: shown as a badge, never editable here */
  isAdmin: boolean;
  isIncomplete: boolean;
};
const memberFromWire = (m: WireAdminMember): AdminMember => ({ id: m.id, ign: m.ign, nickname: m.nickname, job: m.jobId, discordId: m.discordId, isActive: m.isActive, isAdmin: m.isAdmin, isIncomplete: m.isIncomplete });

export async function listAdminMembers(filter: { incompleteOnly?: boolean; includeInactive?: boolean } = {}): Promise<AdminMember[]> {
  const rows = await get<WireAdminMember[]>("/api/v1/admin/members", {
    query: { incomplete: filter.incompleteOnly ? "1" : undefined, includeInactive: filter.includeInactive ? "1" : undefined },
  });
  return rows.map(memberFromWire);
}
export const updateMember = async (id: string, changes: { ign?: string; nickname?: string | null; job?: number }) =>
  memberFromWire(await patch<WireAdminMember>(`/api/v1/admin/members/${id}`, { ign: changes.ign, nickname: changes.nickname, jobId: changes.job }));
export const deactivateMember = async (id: string) => memberFromWire(await post<WireAdminMember>(`/api/v1/admin/members/${id}/deactivate`));
export const reactivateMember = async (id: string) => memberFromWire(await post<WireAdminMember>(`/api/v1/admin/members/${id}/reactivate`));
export const toGuildMemberFromAdmin = (m: AdminMember): GuildMember => ({ id: m.id, ign: m.ign, job: m.job });

// ---------- jobs ----------
type WireJob = Ok<"/api/v1/admin/jobs", "put">[number];
/** Replaces the whole job list: entries with an `id` are kept (renamed/recoloured), entries without are created, missing ones deleted. */
export async function saveJobs(jobs: { id?: number; label: string; color: string }[]): Promise<Job[]> {
  const rows = await put<WireJob[]>("/api/v1/admin/jobs", { jobs: jobs.map((j, i) => ({ ...(j.id !== undefined ? { id: j.id } : {}), label: j.label, color: j.color, sortOrder: i })) });
  return rows.map((j) => ({ id: j.id, label: j.label, color: j.color }));
}

// ---------- activities ----------
type WireActivityPatch = Ok<"/api/v1/admin/activities/{id}", "patch">;
export type ActivitySettings = { registrationCapacity?: number | null; autoBackfill?: boolean; notifyChannelId?: string | null };
export async function updateActivity(id: string, settings: ActivitySettings) {
  const r = await patch<WireActivityPatch>(`/api/v1/admin/activities/${encodeURIComponent(id)}`, settings);
  return { activity: r.activity, promoted: r.promoted };
}

// ---------- layout ----------
type WireLayout = Ok<"/api/v1/admin/activities/{id}/layout", "get">;
export type LayoutTeam = { id?: number; name: string; size: number };
export type LayoutRoom = { id?: number; key: string; name: string; teams: LayoutTeam[] };
export type Layout = { rooms: LayoutRoom[] };
const layoutFromWire = (l: WireLayout): Layout => ({ rooms: l.rooms.map((r) => ({ id: r.id, key: r.key, name: r.name, teams: r.teams.map((t) => ({ id: t.id, name: t.name, size: t.size })) })) });
export const getLayout = async (activityId: string) => layoutFromWire(await get<WireLayout>(`/api/v1/admin/activities/${encodeURIComponent(activityId)}/layout`));
export const putLayout = async (activityId: string, layout: Layout) => layoutFromWire(await put<WireLayout>(`/api/v1/admin/activities/${encodeURIComponent(activityId)}/layout`, { rooms: layout.rooms }));

/** The violations carried by LAYOUT_BELOW_PLACED: a team whose new size is below the highest slot still placed. */
export type LayoutViolation = { teamId: number; placed: number; size: number };
export function layoutViolations(details: Record<string, unknown>): LayoutViolation[] {
  const list = details.violations;
  if (Array.isArray(list)) return list.filter((v): v is LayoutViolation => typeof v?.teamId === "number");
  return typeof details.teamId === "number" ? [{ teamId: details.teamId as number, placed: Number(details.placed), size: Number(details.size) }] : [];
}

// ---------- notifications ----------
type WireNotifications = Ok<"/api/v1/admin/notifications", "get">;
export type NotificationStatus = "pending" | "sending" | "sent" | "dead";
const notifStatus = { PENDING: "pending", SENDING: "sending", SENT: "sent", DEAD: "dead" } as const;
export type NotificationRow = {
  id: number;
  eventType: string;
  target: "dm" | "channel";
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  sentAt: string | null;
};
export type NotificationPage = { items: NotificationRow[]; counts: Record<NotificationStatus, number>; nextCursor: number | null };
export async function listNotifications(opts: { status?: NotificationStatus; cursor?: number; limit?: number } = {}): Promise<NotificationPage> {
  const r = await get<WireNotifications>("/api/v1/admin/notifications", { query: { status: opts.status?.toUpperCase(), cursor: opts.cursor, limit: opts.limit } });
  return {
    items: r.items.map((n) => ({
      id: n.id, eventType: n.eventType, target: n.target === "DISCORD_DM" ? "dm" : "channel", status: notifStatus[n.status], attempts: n.attempts, maxAttempts: n.maxAttempts,
      lastError: n.lastError, lastErrorCode: n.lastErrorCode, createdAt: n.createdAt, sentAt: n.sentAt,
    })),
    counts: { pending: r.counts.PENDING, sending: r.counts.SENDING, sent: r.counts.SENT, dead: r.counts.DEAD },
    nextCursor: r.nextCursor,
  };
}
export const retryNotification = (id: number) => post<{ id: number; status: string }>(`/api/v1/admin/notifications/${id}/retry`);

// ---------- audit log ----------
type WireAudit = Ok<"/api/v1/admin/audit-log", "get">;
export type AuditRow = { id: number; at: string; actorType: "member" | "bot" | "system"; actorId: string | null; action: string; entityType: string; entityId: string; meta: unknown };
export async function listAudit(opts: { cursor?: number; limit?: number; actor?: string; action?: string } = {}): Promise<{ items: AuditRow[]; nextCursor: number | null }> {
  const r = await get<WireAudit>("/api/v1/admin/audit-log", { query: { cursor: opts.cursor, limit: opts.limit, actor: opts.actor || undefined, action: opts.action || undefined } });
  return {
    items: r.items.map((a) => ({ id: a.id, at: a.at, actorType: a.actorType.toLowerCase() as AuditRow["actorType"], actorId: a.actorId, action: a.action, entityType: a.entityType, entityId: a.entityId, meta: a.meta })),
    nextCursor: r.nextCursor,
  };
}

// ---------- auction rounds ----------
type WireRoundOut = Ok<"/api/v1/admin/auctions/rounds", "post">;
const roundTypeToWire = { liveClaim: "LIVE_CLAIM", queueRanked: "QUEUE_RANKED" } as const;
const statusFromWire = { DRAFT: "draft", OPEN: "open", CLOSED: "closed", CANCELLED: "cancelled" } as const;
const summaryOf = (r: WireRoundOut): RoundSummary => ({
  id: r.id, type: r.type === "LIVE_CLAIM" ? "liveClaim" : "queueRanked", name: r.name, status: statusFromWire[r.status] as RoundStatus, durationSec: r.durationSec, winCap: r.winCap,
  startDelaySec: r.startDelaySec, opensAt: r.opensAt, closesAt: r.closesAt,
});
/** `category` left unset means the admin hasn't tagged that item: it's stored without a category (live claim only). */
export type RoundItemInput = { name: string; category?: Category | null; rarity?: string | null; imageUrl?: string | null; disabled?: boolean };
export type RoundInput = { name: string; durationSec: number; startDelaySec: number; winCap?: number; items: RoundItemInput[] };
const itemsToWire = (items: RoundItemInput[]) => items.map((i) => ({ name: i.name, category: i.category ? i.category.toUpperCase() : null, rarity: i.rarity || null, imageUrl: i.imageUrl || null, disabled: i.disabled ?? false }));

export const createRound = async (type: RoundSummary["type"], input: RoundInput) =>
  summaryOf(await post<WireRoundOut>("/api/v1/admin/auctions/rounds", { type: roundTypeToWire[type], name: input.name, durationSec: input.durationSec, startDelaySec: input.startDelaySec, ...(type === "liveClaim" && input.winCap ? { winCap: input.winCap } : {}), items: itemsToWire(input.items) }));
export const updateRound = async (id: number, input: RoundInput & { type: RoundSummary["type"] }) =>
  summaryOf(await patch<WireRoundOut>(`/api/v1/admin/auctions/rounds/${id}`, { name: input.name, durationSec: input.durationSec, startDelaySec: input.startDelaySec, ...(input.type === "liveClaim" && input.winCap ? { winCap: input.winCap } : {}), items: itemsToWire(input.items) }));
export const startRound = async (id: number, opts: { startDelaySec?: number; durationSec?: number } = {}) => summaryOf(await post<WireRoundOut>(`/api/v1/admin/auctions/rounds/${id}/start`, opts));
export const closeRound = async (id: number) => summaryOf(await post<WireRoundOut>(`/api/v1/admin/auctions/rounds/${id}/close`));
export const cancelRound = async (id: number) => summaryOf(await post<WireRoundOut>(`/api/v1/admin/auctions/rounds/${id}/cancel`));
export async function getRoundPreferences(id: number): Promise<{ memberId: string; itemIds: number[] }[]> {
  return (await get<{ lists: { memberId: string; itemIds: number[] }[] }>(`/api/v1/admin/auctions/rounds/${id}/preferences`)).lists;
}
