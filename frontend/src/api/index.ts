import { api, type ApiBody, type ApiResponse } from "./client";

export { ApiError, serverNow, setUnauthorizedHandler } from "./client";

export type Me = ApiResponse<"/api/v1/me", "get">;
export type Member = ApiResponse<"/api/v1/members", "get">[number];
export type AdminMember = ApiResponse<"/api/v1/admin/members", "get">[number];
export type Job = ApiResponse<"/api/v1/jobs", "get">[number];
export type Activity = ApiResponse<"/api/v1/activities", "get">[number];
export type ScheduleEvent = ApiResponse<"/api/v1/events", "get">[number];
export type RegistrationsResponse = ApiResponse<"/api/v1/registrations", "get">;
export type RegistrationEntry = RegistrationsResponse["occurrences"][string][number];
export type RegistrationStatus = "JOINED" | "LEAVE" | "NONE";
export type RegistrationResult = ApiResponse<"/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}", "put">;
export type Plan = ApiResponse<"/api/v1/events/{eventId}/occurrences/{date}/plan", "get">;
export type Layout = ApiResponse<"/api/v1/admin/activities/{id}/layout", "get">;
export type RoundSummary = ApiResponse<"/api/v1/auctions/rounds", "get">;
export type Round = ApiResponse<"/api/v1/auctions/rounds/{id}", "get">;
export type RoundItem = Round["items"][number];
export type RoundResults = ApiResponse<"/api/v1/auctions/rounds/{id}/results", "get">;
export type Queues = ApiResponse<"/api/v1/auctions/queues", "get">;
export type Notifications = ApiResponse<"/api/v1/admin/notifications", "get">;
export type AuditLog = ApiResponse<"/api/v1/admin/audit-log", "get">;
export type QueueCategory = "GEAR" | "CARD" | "RELIC";
export type RoundStatus = Round["status"];
export type NotificationStatus = "PENDING" | "SENDING" | "SENT" | "DEAD";
export type ItemCategory = RoundItem["category"];

export const auth = {
  loginUrl: "/api/v1/auth/discord/login",
  me: () => api("get", "/api/v1/me"),
  logout: () => api("post", "/api/v1/auth/logout"),
};

export const roster = {
  members: () => api("get", "/api/v1/members"),
  jobs: () => api("get", "/api/v1/jobs"),
  activities: () => api("get", "/api/v1/activities"),
  events: () => api("get", "/api/v1/events"),
};

export const registrations = {
  list: (from: string, to: string) => api("get", "/api/v1/registrations", { query: { from, to } }),
  set: (eventId: string, date: string, memberId: string, status: RegistrationStatus) =>
    api("put", "/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}", { path: { eventId, date, memberId }, body: { status } }),
};

export const planner = {
  plan: (eventId: string, date: string) => api("get", "/api/v1/events/{eventId}/occurrences/{date}/plan", { path: { eventId, date } }),
  place: (eventId: string, date: string, memberId: string, body: { teamId: number | null; slot?: number; expectedVersion: number }) =>
    api("put", "/api/v1/events/{eventId}/occurrences/{date}/plan/placements/{memberId}", { path: { eventId, date, memberId }, body }),
  clear: (eventId: string, date: string, expectedVersion: number) =>
    api("post", "/api/v1/events/{eventId}/occurrences/{date}/plan/clear", { path: { eventId, date }, body: { expectedVersion } }),
  copyFromPrevious: (eventId: string, date: string, expectedVersion: number) =>
    api("post", "/api/v1/events/{eventId}/occurrences/{date}/plan/copy-from-previous", { path: { eventId, date }, body: { expectedVersion } }),
  undoBackfill: (eventId: string, date: string, memberId: string, expectedVersion: number) =>
    api("post", "/api/v1/events/{eventId}/occurrences/{date}/plan/placements/{memberId}/undo-backfill", { path: { eventId, date, memberId }, body: { expectedVersion } }),
  layout: (activityId: string) => api("get", "/api/v1/admin/activities/{id}/layout", { path: { id: activityId } }),
  saveLayout: (activityId: string, body: ApiBody<"/api/v1/admin/activities/{id}/layout", "put">) =>
    api("put", "/api/v1/admin/activities/{id}/layout", { path: { id: activityId }, body }),
};

export const auctions = {
  rounds: (status?: RoundStatus) => api("get", "/api/v1/auctions/rounds", { query: status ? { status } : undefined }),
  round: (id: number) => api("get", "/api/v1/auctions/rounds/{id}", { path: { id } }),
  claim: (id: number, itemId: number) => api("post", "/api/v1/auctions/rounds/{id}/items/{itemId}/claim", { path: { id, itemId } }),
  release: (id: number, itemId: number) => api("delete", "/api/v1/auctions/rounds/{id}/items/{itemId}/claim", { path: { id, itemId } }),
  results: (id: number) => api("get", "/api/v1/auctions/rounds/{id}/results", { path: { id } }),
  myResults: (id: number) => api("get", "/api/v1/auctions/rounds/{id}/results/me", { path: { id } }),
  queues: () => api("get", "/api/v1/auctions/queues"),
  joinQueue: (category: QueueCategory) => api("put", "/api/v1/auctions/queues/{category}/me", { path: { category } }),
  leaveQueue: (category: QueueCategory) => api("delete", "/api/v1/auctions/queues/{category}/me", { path: { category } }),
  myPreferences: (id: number) => api("get", "/api/v1/auctions/rounds/{id}/preferences/me", { path: { id } }),
  savePreferences: (id: number, itemIds: number[]) => api("put", "/api/v1/auctions/rounds/{id}/preferences/me", { path: { id }, body: { itemIds } }),
};

export const admin = {
  members: (query?: { incomplete?: "1" | "0"; includeInactive?: "1" | "0" }) => api("get", "/api/v1/admin/members", { query }),
  patchMember: (id: string, body: ApiBody<"/api/v1/admin/members/{id}", "patch">) => api("patch", "/api/v1/admin/members/{id}", { path: { id }, body }),
  deactivateMember: (id: string) => api("post", "/api/v1/admin/members/{id}/deactivate", { path: { id } }),
  reactivateMember: (id: string) => api("post", "/api/v1/admin/members/{id}/reactivate", { path: { id } }),
  saveJobs: (body: ApiBody<"/api/v1/admin/jobs", "put">) => api("put", "/api/v1/admin/jobs", { body }),
  patchActivity: (id: string, body: ApiBody<"/api/v1/admin/activities/{id}", "patch">) => api("patch", "/api/v1/admin/activities/{id}", { path: { id }, body }),
  createRound: (body: ApiBody<"/api/v1/admin/auctions/rounds", "post">) => api("post", "/api/v1/admin/auctions/rounds", { body }),
  patchRound: (id: number, body: ApiBody<"/api/v1/admin/auctions/rounds/{id}", "patch">) => api("patch", "/api/v1/admin/auctions/rounds/{id}", { path: { id }, body }),
  startRound: (id: number, body: ApiBody<"/api/v1/admin/auctions/rounds/{id}/start", "post">) => api("post", "/api/v1/admin/auctions/rounds/{id}/start", { path: { id }, body }),
  closeRound: (id: number) => api("post", "/api/v1/admin/auctions/rounds/{id}/close", { path: { id } }),
  cancelRound: (id: number) => api("post", "/api/v1/admin/auctions/rounds/{id}/cancel", { path: { id } }),
  roundPreferences: (id: number) => api("get", "/api/v1/admin/auctions/rounds/{id}/preferences", { path: { id } }),
  notifications: (query?: { status?: NotificationStatus; eventType?: string; cursor?: number; limit?: number }) => api("get", "/api/v1/admin/notifications", { query }),
  retryNotification: (id: number) => api("post", "/api/v1/admin/notifications/{id}/retry", { path: { id } }),
  auditLog: (query?: { cursor?: number; limit?: number; actor?: string; action?: string; from?: string; to?: string }) => api("get", "/api/v1/admin/audit-log", { query }),
};

