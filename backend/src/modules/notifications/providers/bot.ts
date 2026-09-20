import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NotificationProvider, OutboundMessage, SendResult } from '../types.js';

/** Bot-side error codes that will never succeed on retry. */
const PERMANENT = new Set(['DM_CLOSED', 'USER_NOT_FOUND', 'CHANNEL_NOT_FOUND']);

export const sign = (secret: string, timestamp: string, rawBody: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

/** Used by the receiving bot (and the fake bot in tests). Rejects altered bodies and timestamps older than 5 minutes. */
export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  nowSec = Date.now() / 1000,
): boolean {
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSec - Number(timestamp)) > 300) return false;
  const want = Buffer.from(sign(secret, timestamp, rawBody), 'hex');
  const got = Buffer.from(signature, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Maps an HTTP outcome to a send result (design 8.3 table). */
export function classify(
  status: number,
  body: { code?: unknown } | null,
  retryAfterHeader: string | null,
): SendResult {
  if (status >= 200 && status < 300) return { ok: true };
  const code = typeof body?.code === 'string' ? body.code : `HTTP_${status}`;
  if (PERMANENT.has(code)) return { ok: false, kind: 'dead', code, message: `bot rejected: ${code}` };
  if (status === 429) {
    const secs = Number(retryAfterHeader);
    return {
      ok: false,
      kind: 'retry',
      code,
      message: 'rate limited',
      ...(Number.isFinite(secs) && secs >= 0 ? { retryAfterMs: secs * 1000 } : {}),
    };
  }
  if (status >= 500 || status === 408)
    return { ok: false, kind: 'retry', code, message: `bot returned ${status}` };
  return { ok: false, kind: 'dead', code, message: `bot returned ${status}` };
}

export class BotProvider implements NotificationProvider {
  constructor(private readonly cfg: { url: string; secret: string; timeoutMs?: number }) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    const body = JSON.stringify({
      id: msg.id,
      eventType: msg.eventType,
      target: msg.target,
      discordUserId: msg.discordUserId,
      channelId: msg.channelId,
      content: msg.content,
      allowedMentions: msg.allowedMentions,
    });
    const ts = Math.floor(Date.now() / 1000).toString();
    try {
      const res = await fetch(`${this.cfg.url.replace(/\/$/, '')}/v1/notifications`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-notify-timestamp': ts,
          'x-notify-signature': sign(this.cfg.secret, ts, body),
          'idempotency-key': msg.idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 5000),
      });
      const json = (await res.json().catch(() => null)) as { code?: unknown } | null;
      return classify(res.status, json, res.headers.get('retry-after'));
    } catch (err) {
      // Timeouts and network errors are retryable. Never include the secret or body in the message.
      const name = (err as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      return { ok: false, kind: 'retry', code: name, message: name };
    }
  }
}
