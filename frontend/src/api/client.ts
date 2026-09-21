import { messageForCode } from "./errors";
import { serverClock } from "./serverClock";

/** A failed API call: `code` is the stable error code from the `{ error: { code } }` envelope (or a client-side one). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Text for the user, translated by code. */
  userMessage(isThai: boolean) {
    return messageForCode(this.code, isThai, this.message);
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

let unauthorizedHandler: (() => void) | null = null;
/** Called once for every 401 AUTH_REQUIRED, so the app can drop the session and show the sign-in path. */
export const onUnauthorized = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

type Options = { body?: unknown; query?: Record<string, string | number | undefined>; signal?: AbortSignal };

function buildUrl(path: string, query?: Options["query"]) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  return url;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const env = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (env && typeof env.code === "string") {
    return new ApiError(
      res.status,
      env.code,
      typeof env.message === "string" ? env.message : env.code,
      env.details && typeof env.details === "object" ? (env.details as Record<string, unknown>) : {},
    );
  }
  return new ApiError(res.status, `HTTP_${res.status}`, res.statusText || "Request failed");
}

/**
 * The one way to call the API: same-origin (the Vite dev proxy or the reverse proxy forwards /api), cookies included,
 * `X-Requested-With` on every write (the backend's CSRF check), the error envelope parsed into a typed `ApiError`,
 * and every `serverTime` fed to the server clock.
 */
export async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (WRITE_METHODS.has(method)) headers["X-Requested-With"] = "clover-web";
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), { method, headers, body, credentials: "include", signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server");
  }
  const receivedAt = Date.now();
  const headerTime = res.headers.get("x-server-time");
  if (headerTime) serverClock.observe(headerTime, sentAt, receivedAt);

  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && error.code === "AUTH_REQUIRED") unauthorizedHandler?.();
    throw error;
  }
  if (res.status === 204) return undefined as T;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "INVALID_RESPONSE", "The server sent a response that is not JSON");
  }
  const bodyTime = (json as { serverTime?: unknown } | null)?.serverTime;
  if (typeof bodyTime === "string") serverClock.observe(bodyTime, sentAt, receivedAt);
  return json as T;
}

export const get = <T>(path: string, options?: Options) => request<T>("GET", path, options);
export const post = <T>(path: string, body?: unknown, options?: Options) => request<T>("POST", path, { ...options, body });
export const put = <T>(path: string, body?: unknown, options?: Options) => request<T>("PUT", path, { ...options, body });
export const patch = <T>(path: string, body?: unknown, options?: Options) => request<T>("PATCH", path, { ...options, body });
export const del = <T>(path: string, options?: Options) => request<T>("DELETE", path, options);
