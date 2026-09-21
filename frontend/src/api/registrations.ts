import { get, put } from "./client";
import { registrationFromWire, registrationToWire, type UiRegistrationStatus } from "./enums";
import type { paths } from "./schema";
import type { Attendance } from "../data/guild";

type RangeBody = paths["/api/v1/registrations"]["get"]["responses"][200]["content"]["application/json"];
type PutBody = paths["/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}"]["put"]["responses"][200]["content"]["application/json"];

/** One member's registration for one occurrence (UI names; `placed` / `reserveOrder` only for planner activities). */
export type Registration = {
  memberId: string;
  status: UiRegistrationStatus;
  waitlistPos?: number;
  placed?: boolean;
  reserveOrder?: number | null;
};

/** "YYYY-MM-DD:eventId" -> registrations in registration order. */
export type RegistrationBook = Record<string, Registration[]>;

export async function getRegistrations(from: string, to: string, signal?: AbortSignal): Promise<RegistrationBook> {
  const body = await get<RangeBody>("/api/v1/registrations", { query: { from, to }, signal });
  const book: RegistrationBook = {};
  for (const [key, rows] of Object.entries(body.occurrences)) {
    book[key] = rows.map((r) => ({
      memberId: r.memberId,
      status: registrationFromWire(r.status),
      ...(r.waitlistPos !== undefined ? { waitlistPos: r.waitlistPos } : {}),
      ...(r.placed !== undefined ? { placed: r.placed } : {}),
      ...(r.reserveOrder !== undefined ? { reserveOrder: r.reserveOrder } : {}),
    }));
  }
  return book;
}

export type SetRegistrationResult = {
  status: UiRegistrationStatus | "none";
  waitlistPosition: number | null;
  /** members promoted from the waitlist by this change */
  promoted: string[];
  /** planner slots given to a reserve by this change */
  backfilled: { teamName: string; slot: number; vacatedMemberId: string; promotedMemberId: string }[];
  planVersion: number;
};

/** `memberId` is a member id, or "me" for the signed-in member; `status` null clears the registration. */
export async function setRegistration(
  eventId: string,
  date: string,
  memberId: string | "me",
  status: Attendance | null,
): Promise<SetRegistrationResult> {
  const body = await put<PutBody>(`/api/v1/events/${encodeURIComponent(eventId)}/occurrences/${date}/registrations/${memberId}`, {
    status: registrationToWire(status),
  });
  return {
    status: body.status === "NONE" ? "none" : registrationFromWire(body.status),
    waitlistPosition: body.waitlistPosition,
    promoted: body.promoted,
    backfilled: body.backfilled.map((b) => ({
      teamName: b.teamName,
      slot: b.slot,
      vacatedMemberId: b.vacatedMemberId,
      promotedMemberId: b.promotedMemberId,
    })),
    planVersion: body.planVersion,
  };
}
