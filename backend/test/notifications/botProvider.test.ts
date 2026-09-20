import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BotProvider,
  classify,
  sign,
  verifySignature,
} from '../../src/modules/notifications/providers/bot.js';
import type { OutboundMessage } from '../../src/modules/notifications/types.js';
import { NOTIFY_SECRET, startFakeBot, type FakeBot } from '../helpers/fakeBot.js';

let bot: FakeBot;
beforeAll(async () => (bot = await startFakeBot()));
afterAll(() => bot.close());

const msg: OutboundMessage = {
  id: 7,
  eventType: 'reserve.promoted',
  target: 'DM',
  discordUserId: '111',
  content: 'hello',
  allowedMentions: { parse: [], users: ['111'] },
  idempotencyKey: 'key-7',
};
const provider = () => new BotProvider({ url: bot.url, secret: NOTIFY_SECRET, timeoutMs: 300 });

describe('WP5 bot provider (HMAC push)', () => {
  it('sends a signed request with an idempotency key and the structured body', async () => {
    const r = await provider().send(msg);
    expect(r).toEqual({ ok: true });
    const last = bot.requests.at(-1)!;
    expect(last.key).toBe('key-7');
    expect(last.body).toMatchObject({
      id: 7,
      target: 'DM',
      discordUserId: '111',
      allowedMentions: { users: ['111'] },
    });
  });

  it('a wrong secret is rejected by the bot (401 -> DEAD), a body altered after signing fails verification', async () => {
    const r = await new BotProvider({ url: bot.url, secret: 'wrong-secret' }).send(msg);
    expect(r).toMatchObject({ ok: false, kind: 'dead', code: 'BAD_SIGNATURE' });

    const body = JSON.stringify({ hello: 'world' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(NOTIFY_SECRET, ts, body);
    expect(verifySignature(NOTIFY_SECRET, ts, body, sig)).toBe(true);
    expect(verifySignature(NOTIFY_SECRET, ts, body.replace('world', 'w0rld'), sig)).toBe(false);
    const res = await fetch(`${bot.url}/v1/notifications`, {
      method: 'POST',
      headers: { 'x-notify-timestamp': ts, 'x-notify-signature': sig },
      body: body.replace('world', 'w0rld'),
    });
    expect(res.status).toBe(401);
  });

  it('a timestamp older than 5 minutes is rejected', () => {
    const body = '{}';
    const old = String(Math.floor(Date.now() / 1000) - 400);
    expect(verifySignature(NOTIFY_SECRET, old, body, sign(NOTIFY_SECRET, old, body))).toBe(false);
  });

  it('classifies bot outcomes: 5xx/timeout retry, 429 Retry-After, permanent codes and other 4xx dead', async () => {
    expect(classify(200, null, null)).toEqual({ ok: true });
    expect(classify(503, null, null)).toMatchObject({ kind: 'retry', code: 'HTTP_503' });
    expect(classify(408, null, null)).toMatchObject({ kind: 'retry' });
    expect(classify(429, null, '90')).toMatchObject({ kind: 'retry', retryAfterMs: 90_000 });
    expect(classify(400, { code: 'DM_CLOSED' }, null)).toMatchObject({ kind: 'dead', code: 'DM_CLOSED' });
    expect(classify(404, { code: 'USER_NOT_FOUND' }, null)).toMatchObject({ kind: 'dead' });
    expect(classify(404, { code: 'CHANNEL_NOT_FOUND' }, null)).toMatchObject({ kind: 'dead' });
    expect(classify(400, null, null)).toMatchObject({ kind: 'dead', code: 'HTTP_400' });

    bot.respond(
      { status: 503 },
      { status: 429, headers: { 'retry-after': '12' } },
      { status: 400, body: { code: 'DM_CLOSED' } },
      { status: 200, delayMs: 800 },
    );
    expect(await provider().send(msg)).toMatchObject({ kind: 'retry', code: 'HTTP_503' });
    expect(await provider().send(msg)).toMatchObject({ kind: 'retry', retryAfterMs: 12_000 });
    expect(await provider().send(msg)).toMatchObject({ kind: 'dead', code: 'DM_CLOSED' });
    expect(await provider().send(msg)).toMatchObject({ kind: 'retry', code: 'TIMEOUT' });
  });

  it('a network error is retryable and never leaks the secret', async () => {
    const r = await new BotProvider({
      url: 'http://127.0.0.1:9',
      secret: NOTIFY_SECRET,
      timeoutMs: 300,
    }).send(msg);
    expect(r).toMatchObject({ ok: false, kind: 'retry', code: 'NETWORK_ERROR' });
    expect(JSON.stringify(r)).not.toContain(NOTIFY_SECRET);
  });
});
