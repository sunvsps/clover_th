import { useEffect, useRef, useState } from "react";
import { isApiError, type ApiError } from "./client";
import { serverClock } from "./serverClock";

type Options = { intervalMs: number; enabled?: boolean; /** changing it restarts polling (e.g. the visible week) */ key?: string };

/**
 * Polls `fetcher` every `intervalMs` (immediately on mount), pausing while the tab is hidden and refreshing when it
 * becomes visible again or the window gets focus. `refresh()` fetches now (e.g. after a write). `serverNow()` is the server's clock (offset learned from `serverTime` / `X-Server-Time` on
 * every response), which countdowns must use instead of the browser clock.
 */
export function usePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, { intervalMs, enabled = true, key }: Options) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [offsetMs, setOffsetMs] = useState(serverClock.offset());
  const fetcherRef = useRef(fetcher);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      if (stopped) return;
      controller?.abort(); // a newer request supersedes one still in flight
      const mine = (controller = new AbortController());
      try {
        const result = await fetcherRef.current(mine.signal);
        if (stopped || mine.signal.aborted) return;
        setData(result);
        setError(null);
        setOffsetMs(serverClock.offset());
      } catch (err) {
        if (stopped || mine.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(isApiError(err) ? err : null);
      }
      if (!stopped && document.visibilityState !== "hidden") timer = setTimeout(tick, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        clearTimeout(timer);
        void tick();
      }
    };
    const onFocus = () => {
      if (stopped) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    refreshRef.current = () => {
      clearTimeout(timer);
      void tick();
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      refreshRef.current = () => {};
    };
  }, [enabled, intervalMs, key]);

  return { data, error, refresh: () => refreshRef.current(), serverNow: () => Date.now() + offsetMs };
}
