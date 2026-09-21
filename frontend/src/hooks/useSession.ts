import { navigate } from "../lib/navigate";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMe, isApiError, LOGIN_URL, logout, onUnauthorized, type ApiError, type Me } from "../api";

/** The `?authError=` codes the backend redirects to after a failed Discord login. */
export const AUTH_ERROR_CODES = ["AUTH_NOT_REGISTERED", "AUTH_MEMBER_INACTIVE", "AUTH_STATE_INVALID", "AUTH_OAUTH_FAILED"] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "authError"; code: AuthErrorCode }
  | { status: "expired" }
  | { status: "error"; error: ApiError | null }
  | { status: "ready"; me: Me };

/** Reads and removes `?authError=` from the address bar (a reload must not show the error again). */
function takeAuthError(): AuthErrorCode | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("authError");
  if (value === null) return null;
  params.delete("authError");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  return (AUTH_ERROR_CODES as readonly string[]).includes(value) ? (value as AuthErrorCode) : "AUTH_OAUTH_FAILED";
}

/**
 * Who is using the app, from the server: `GET /api/v1/me` on load (the cookie session is HttpOnly, the browser never
 * sees it), `?authError=` after a failed Discord login, sign-out via the API, and a 401 anywhere means the session
 * expired. Nothing about the user is hardcoded here.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>(() => {
    const code = takeAuthError();
    return code ? { status: "authError", code } : { status: "loading" };
  });
  const wasReady = useRef(false);

  const fetchMe = useCallback(async (): Promise<SessionState> => {
    try {
      return { status: "ready", me: await getMe() };
    } catch (err) {
      if (isApiError(err) && err.status === 401) return { status: "signedOut" };
      return { status: "error", error: isApiError(err) ? err : null };
    }
  }, []);

  // first load: skipped when we arrive from a failed login (the error screen comes first)
  const [skipFirstLoad] = useState(() => state.status !== "loading");
  useEffect(() => {
    if (!skipFirstLoad) void fetchMe().then(setState);
  }, [skipFirstLoad, fetchMe]);

  useEffect(() => {
    wasReady.current = state.status === "ready";
  }, [state.status]);

  useEffect(() => {
    onUnauthorized(() => {
      if (wasReady.current) setState({ status: "expired" });
    });
    return () => onUnauthorized(null);
  }, []);

  const me = state.status === "ready" ? state.me : null;

  function signIn() {
    navigate(LOGIN_URL);
  }

  async function signOut() {
    try {
      await logout();
    } catch {
      /* the cookie may already be gone; either way the user is signed out from the app's point of view */
    }
    setState({ status: "signedOut" });
  }

  return {
    state,
    isAuthenticated: me !== null,
    memberId: me?.memberId ?? "",
    userName: me?.ign ?? "",
    ign: me?.ign ?? "",
    /** what the server says: `GET /me` */
    isAdmin: me?.isAdmin ?? false,
    signIn,
    signOut,
    /** leave the auth-error screen and look for a session again */
    retry: async () => {
      setState({ status: "loading" });
      setState(await fetchMe());
    },
    dismissAuthError: () => setState({ status: "signedOut" }),
  };
}

export type Session = ReturnType<typeof useSession>;
