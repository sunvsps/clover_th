import type { paths } from "./schema";
import type { Attendance } from "../data/guild";

/**
 * Wire enums <-> UI strings. The API speaks JOINED / WAITLISTED / LEAVE / NONE (uppercase); the UI keeps its own
 * lowercase names. This is the ONLY place that mapping exists, so the rest of the app never sees a wire enum.
 */
type Op<P extends keyof paths> = paths[P] extends { put: infer M } ? M : never;
type RegistrationBody = Op<"/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}"> extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : never;
export type WireRegistrationRequest = RegistrationBody extends { status: infer S } ? S : never; // "JOINED" | "LEAVE" | "NONE"
export type WireRegistrationStatus = "JOINED" | "WAITLISTED" | "LEAVE";

export type UiRegistrationStatus = "joined" | "waitlisted" | "leave";

const fromWire: Record<WireRegistrationStatus, UiRegistrationStatus> = {
  JOINED: "joined",
  WAITLISTED: "waitlisted",
  LEAVE: "leave",
};

export const registrationFromWire = (status: WireRegistrationStatus): UiRegistrationStatus => fromWire[status];

/** UI attendance (or null = clear) -> the value the registration PUT expects. */
export const registrationToWire = (status: Attendance | null): "JOINED" | "LEAVE" | "NONE" =>
  status === "joined" ? "JOINED" : status === "leave" ? "LEAVE" : "NONE";
