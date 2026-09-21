import { useRef } from "react";
import { getRound, usePolling, type AuctionItem, type Round } from "../api";

const OPEN_POLL_MS = 1500;
const IDLE_POLL_MS = 10_000;

/**
 * One round, kept fresh: polls `GET /auctions/rounds/:id` every 1.5 s while it is open (with ETag, so an unchanged
 * round costs a 304) and every 10 s otherwise. Every response also teaches the server clock offset.
 * `apply` puts a claim/release answer into the state at once (no wait for the next poll).
 */
export function useRound(roundId: number | null, enabled: boolean) {
  const etag = useRef<string | null>(null);
  const cache = useRef<Round | null>(null);
  const polled = usePolling<Round | null>(
    async (signal) => {
      if (roundId === null) return null;
      if (cache.current && cache.current.id !== roundId) {
        cache.current = null;
        etag.current = null;
      }
      const res = await getRound(roundId, etag.current, signal);
      if (res) {
        etag.current = res.etag;
        cache.current = res.round;
      }
      return cache.current;
    },
    {
      intervalMs: (latest) => ((latest as Round | null)?.status === "open" ? OPEN_POLL_MS : IDLE_POLL_MS),
      enabled: enabled && roundId !== null,
      key: String(roundId),
    },
  );
  const round = polled.data && polled.data.id === roundId ? polled.data : null;

  function apply(item: AuctionItem, myWinCount: number) {
    const current = cache.current;
    if (!current || current.id !== roundId) return;
    const next = { ...current, myWinCount, items: current.items.map((i) => (i.id === item.id ? item : i)) };
    cache.current = next;
    etag.current = null; // the next poll fetches the full state
    polled.setData(next);
  }

  return { round, error: polled.error, refresh: polled.refresh, apply };
}
