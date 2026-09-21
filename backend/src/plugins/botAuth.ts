import type { FastifyRequest } from 'fastify';
import { verifyBotKey } from '../lib/botKey.js';
import { AppError, errors } from '../lib/errors.js';

/**
 * onRequest guard for bot routes: header X-Bot-Key hashed and compared to BOT_API_KEYS digests.
 * The key is verified FIRST and a valid key always passes: an anonymous caller must never be able to lock the real bot
 * out (its IP may be shared with the attacker behind a proxy). Only INVALID attempts are throttled per IP (in memory,
 * one instance): past BOT_KEY_FAILS_PER_MIN failures a minute they get 429 instead of 401, so the key cannot be
 * brute-forced (keys are 256-bit anyway). The global rate limiter runs after the guards, so it cannot cover this.
 */
export async function requireBotKey(request: FastifyRequest) {
  const { env, botFailures } = request.server;
  const h = request.headers['x-bot-key'];
  const key = Array.isArray(h) ? h[0] : h;
  if (key && key.length <= 256 && verifyBotKey(key, env.BOT_API_KEYS)) return;

  const now = Date.now();
  const entry = botFailures.get(request.ip);
  const cur = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 60_000 };
  cur.count++;
  if (botFailures.size > 10_000) botFailures.clear(); // bounded memory
  botFailures.set(request.ip, cur);
  if (cur.count > env.BOT_KEY_FAILS_PER_MIN)
    throw new AppError('RATE_LIMITED', 429, 'Too many invalid bot key attempts');
  throw errors.botKeyInvalid();
}
