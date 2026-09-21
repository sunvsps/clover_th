import type { paths } from "./schema";
import { mockRequest } from "./mock/server";

/** Mock mode: in-browser fake backend (VITE_API_MODE=mock at build time, or localStorage "clover.apiMode" = "mock"). */
export const isMockMode = () => {
  try {
    return import.meta.env.VITE_API_MODE === "mock" || localStorage.getItem("clover.apiMode") === "mock";
  } catch {
    return import.meta.env.VITE_API_MODE === "mock";
  }
};

type Method = "get" | "post" | "put" | "patch" | "delete";
type PathsFor<M extends Method> = { [P in keyof paths]: paths[P] extends Record<M, infer Op> ? (Op extends { responses: unknown } ? P : never) : never }[keyof paths];
type Op<P extends keyof paths, M extends Method> = paths[P] extends Record<M, infer O> ? O : never;
type JsonOf<T> = T extends { content: { "application/json": infer J } } ? J : never;
type SuccessOf<O> = O extends { responses: infer R } ? JsonOf<R[keyof R & (200 | 201)]> : never;
type BodyOf<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? B : O extends { requestBody?: { content: { "application/json": infer B } } } ? B | undefined : undefined;
type QueryOf<O> = O extends { parameters: { query?: infer Q } } ? Q : undefined;

export type ApiResponse<P extends keyof paths, M extends Method> = SuccessOf<Op<P, M>>;
export type ApiBody<P extends keyof paths, M extends Method> = BodyOf<Op<P, M>>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called once whenever the API answers 401 (session expired); the app shell uses it to reset to signed-out. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

/** Server clock minus browser clock, in ms. Updated from every response that carries serverTime. */
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;
function noteServerTime(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { serverTime?: unknown }).serverTime === "string") {
    const server = Date.parse((payload as { serverTime: string }).serverTime);
    if (!Number.isNaN(server)) clockOffsetMs = server - Date.now();
  }
}

type RequestOptions<P extends keyof paths, M extends Method> = {
  path?: Record<string, string | number>;
  query?: QueryOf<Op<P, M>>;
  body?: ApiBody<P, M>;
  signal?: AbortSignal;
};

function fill(template: string, params: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(params[key] ?? "")));
}

export async function api<M extends Method, P extends PathsFor<M>>(method: M, path: P, options: RequestOptions<P, M> = {}): Promise<ApiResponse<P, M>> {
  let url = fill(path, options.path);
  if (options.query) {
    const params = new URLSearchParams();
    Object.entries(options.query as Record<string, unknown>).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  if (isMockMode()) {
    const result = await mockRequest(method, url, options.body);
    noteServerTime(result.body);
    if (result.status >= 400) {
      const error = (result.body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
      if (result.status === 401) onUnauthorized?.();
      throw new ApiError(result.status, error?.code ?? "HTTP_ERROR", error?.message ?? "error", error?.details ?? {});
    }
    return result.body as ApiResponse<P, M>;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "get") headers["X-Requested-With"] = "fetch"; // CSRF check on cookie-authenticated writes
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method: method.toUpperCase(),
    credentials: "include",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  noteServerTime(payload);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(response.status, error?.code ?? "HTTP_ERROR", error?.message ?? response.statusText, error?.details ?? {});
  }
  return payload as ApiResponse<P, M>;
}
