/**
 * Server clock offset. Every API response that carries `serverTime` (body) or `X-Server-Time` (header) is a sample:
 * offset = serverTime - (request sent + round trip / 2). Countdowns must be computed against `serverClock.now()`,
 * never against the browser clock, which may be minutes off (design 9). The best sample (smallest round trip) wins
 * for a minute; after that any newer sample replaces it.
 */
let offsetMs = 0;
let bestRtt = Infinity;
let sampledAt = 0;

export const serverClock = {
  observe(serverTimeIso: string, sentAt: number, receivedAt: number) {
    const server = Date.parse(serverTimeIso);
    if (Number.isNaN(server)) return;
    const rtt = Math.max(0, receivedAt - sentAt);
    if (rtt <= bestRtt || receivedAt - sampledAt > 60_000) {
      offsetMs = server - (sentAt + rtt / 2);
      bestRtt = rtt;
      sampledAt = receivedAt;
    }
  },
  /** Current server time in epoch milliseconds. */
  now: () => Date.now() + offsetMs,
  /** server minus browser, in milliseconds. */
  offset: () => offsetMs,
  reset() {
    offsetMs = 0;
    bestRtt = Infinity;
    sampledAt = 0;
  },
};
