import { get, post, put } from "./client";
import { registrationFromWire } from "./enums";
import type { paths } from "./schema";

type Plan200 = paths["/api/v1/events/{eventId}/occurrences/{date}/plan"]["get"]["responses"][200]["content"]["application/json"];

/** Registration state of a placed member: "none" = placed but not registered (flagged in the UI). */
export type PlacedRegistration = "joined" | "waitlisted" | "leave" | "none";
export type PlacementSource = "admin" | "copy" | "autoBackfill";

export type PlanPlacement = {
  memberId: string;
  slot: number;
  registration: PlacedRegistration;
  source: PlacementSource;
  /** only for source "autoBackfill": who this member replaced */
  backfill?: { vacatedMemberId: string | null; reason: string | null; at: string };
};
export type PlanTeam = { id: number; name: string; size: number; archived: boolean; placements: PlanPlacement[] };
export type PlanRoom = { id: number; key: string; name: string; archived: boolean; capacity: number; teams: PlanTeam[] };
export type PlanReserve = { memberId: string; registeredAt: string; order: number };
export type Plan = {
  eventId: string;
  date: string;
  startsAt: string | null;
  version: number;
  autoBackfill: boolean;
  rooms: PlanRoom[];
  reserves: PlanReserve[];
};

const sourceFromWire = { ADMIN: "admin", COPY: "copy", AUTO_BACKFILL: "autoBackfill" } as const;

/** Wire plan -> UI plan (wire enums are translated here only). Also used for the plan carried by a version conflict. */
export function planFromWire(p: Plan200): Plan {
  return {
    eventId: p.eventId,
    date: p.date,
    startsAt: p.startsAt,
    version: p.version,
    autoBackfill: p.autoBackfill,
    rooms: p.rooms.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      archived: r.archived,
      capacity: r.capacity,
      teams: r.teams.map((t) => ({
        id: t.id,
        name: t.name,
        size: t.size,
        archived: t.archived,
        placements: t.placements.map((x) => ({
          memberId: x.memberId,
          slot: x.slot,
          registration: x.regStatus === "NONE" ? "none" : registrationFromWire(x.regStatus),
          source: sourceFromWire[x.source],
          ...(x.backfill ? { backfill: x.backfill } : {}),
        })),
      })),
    })),
    reserves: p.reserves,
  };
}

const base = (eventId: string, date: string) => `/api/v1/events/${encodeURIComponent(eventId)}/occurrences/${date}/plan`;

export async function getPlan(eventId: string, date: string, signal?: AbortSignal): Promise<Plan> {
  return planFromWire(await get<Plan200>(base(eventId, date), { signal }));
}

/** `teamId` null unplaces; `slot` omitted = lowest free slot; an occupied slot swaps. */
export const placeMember = (eventId: string, date: string, memberId: string, target: { teamId: number | null; slot?: number }, expectedVersion: number) =>
  put<{ version: number }>(`${base(eventId, date)}/placements/${memberId}`, { ...target, expectedVersion });

export const clearPlan = (eventId: string, date: string, expectedVersion: number) =>
  post<{ version: number; removed: number }>(`${base(eventId, date)}/clear`, { expectedVersion });

export type CopyResult = { copied: number; skipped: { memberId: string; reason: string }[]; version: number; sourceDate: string };
export const copyFromPrevious = (eventId: string, date: string, expectedVersion: number, sourceDate?: string) =>
  post<CopyResult>(`${base(eventId, date)}/copy-from-previous`, { expectedVersion, ...(sourceDate ? { sourceDate } : {}) });

export const undoBackfill = (eventId: string, date: string, memberId: string, expectedVersion: number) =>
  post<{ version: number; cancelledNotifications: number }>(`${base(eventId, date)}/placements/${memberId}/undo-backfill`, { expectedVersion });
