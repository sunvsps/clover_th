import { useEffect, useRef, useState } from "react";
import { isApiError, type ApiError } from "./client";
import { serverClock } from "./serverClock";

type Options = { intervalMs: number; enabled?: boolean };

/**
 * Polls `fetcher` every `intervalMs` (immediately on mount), pausing while the tab is hidden and refreshing when it
 * becomes visible again. `serverNow()` is the server's clock (offset learned from `serverTime` / `X-Server-Time` on
 * every response), which countdowns must use instead of the browser clock.
 */
export function usePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, { intervalMs, enabled = true }: Options) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [offsetMs, setOffsetMs] = useState(serverClock.offset());
  const fetcherRef = useRef(fetcher);
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
      controller = new AbortController();
      try {
        const result = await fetcherRef.current(controller.signal);
        if (stopped) return;
        setData(result);
        setError(null);
        setOffsetMs(serverClock.offset());
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
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
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs]);

  return { data, error, serverNow: () => Date.now() + offsetMs };
}
