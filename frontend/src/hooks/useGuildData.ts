import { useCallback, useEffect, useState } from "react";
import { isApiError, loadGuildData, type ApiError, type GuildData } from "../api";

export type GuildDataState =
  | { status: "loading" }
  | { status: "error"; error: ApiError | null }
  | { status: "ready"; data: GuildData };

/** Loads /members, /jobs, /events and /activities once the user is signed in. */
export function useGuildData(enabled: boolean) {
  const [state, setState] = useState<GuildDataState>({ status: "loading" });

  const fetchAll = useCallback(async (): Promise<GuildDataState> => {
    try {
      return { status: "ready", data: await loadGuildData() };
    } catch (err) {
      return { status: "error", error: isApiError(err) ? err : null };
    }
  }, []);

  useEffect(() => {
    if (enabled) void fetchAll().then(setState);
  }, [enabled, fetchAll]);

  return {
    state,
    reload: async () => {
      setState({ status: "loading" });
      setState(await fetchAll());
    },
  };
}
