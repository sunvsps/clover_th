import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifySignature } from '../../src/modules/notifications/providers/bot.js';

export const NOTIFY_SECRET = 'notify-secret-for-tests';

export type FakeBot = {
  url: string;
  requests: { key: string | undefined; body: Record<string, unknown> }[];
  /** Responses consumed in order (default 200). */
  respond: (
    ...r: { status: number; body?: object; headers?: Record<string, string>; delayMs?: number }[]
  ) => void;
  close: () => Promise<void>;
};

/** A fake bot receiver: verifies the HMAC signature and timestamp like the real one must. */
export async function startFakeBot(): Promise<FakeBot> {
  const requests: FakeBot['requests'] = [];
  const script: Parameters<FakeBot['respond']> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const ts = String(req.headers['x-notify-timestamp'] ?? '');
      const sig = String(req.headers['x-notify-signature'] ?? '');
      if (req.url !== '/v1/notifications' || !verifySignature(NOTIFY_SECRET, ts, raw, sig)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: 'BAD_SIGNATURE' }));
      }
      requests.push({ key: req.headers['idempotency-key'] as string | undefined, body: JSON.parse(raw) });
      const next = script.shift() ?? { status: 200 };
      setTimeout(() => {
        res.writeHead(next.status, { 'content-type': 'application/json', ...(next.headers ?? {}) });
        res.end(JSON.stringify(next.body ?? {}));
      }, next.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    respond: (...r) => void script.push(...r),
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}
