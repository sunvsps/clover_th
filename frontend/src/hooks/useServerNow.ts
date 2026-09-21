import { useEffect, useState } from "react";
import { serverClock } from "../api";

/** The server's current time in ms, re-rendering every `everyMs` (countdowns run on this, never on the browser clock). */
export function useServerNow(everyMs = 250, enabled = true) {
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(serverClock.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs, enabled]);
  return now;
}
