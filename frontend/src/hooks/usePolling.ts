import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Calls `load` immediately and then every `intervalMs` while the tab is visible.
 * `deps` restarts the cycle; `refresh()` forces a reload. Errors are kept in `error` without clearing the last data.
 */
export function usePolling<T>(load: (() => Promise<T>) | null, intervalMs: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  const tick = useRef(0);
  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const my = ++tick.current;
    setLoading(true);
    try {
      const next = await fn();
      if (my === tick.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (my === tick.current) setError(err);
    } finally {
      if (my === tick.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!load) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, load === null, ...deps]);

  return { data, error, loading, refresh, setData };
}
