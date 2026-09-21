import type { FastifyRequest } from 'fastify';
import { verifyBotKey } from '../lib/botKey.js';
import { AppError, errors } from '../lib/errors.js';

/**
 * onRequest guard for bot routes: header X-Bot-Key hashed and compared to BOT_API_KEYS digests.
 * Wrong keys are counted per IP (in memory, one instance): past BOT_KEY_FAILS_PER_MIN failures a minute the caller
 * gets 429 RATE_LIMITED even for a correct key until the window ends, so the key cannot be brute-forced.
 * (The global rate limiter runs after the guards, so it cannot cover failed authentication.)
 */
export async function requireBotKey(request: FastifyRequest) {
  const { env, botFailures } = request.server;
  const now = Date.now();
  const entry = botFailures.get(request.ip);
  if (entry && entry.resetAt > now && entry.count >= env.BOT_KEY_FAILS_PER_MIN) {
    throw new AppError('RATE_LIMITED', 429, 'Too many failed bot key attempts');
  }
  const h = request.headers['x-bot-key'];
  const key = Array.isArray(h) ? h[0] : h;
  if (!key || key.length > 256 || !verifyBotKey(key, env.BOT_API_KEYS)) {
    if (botFailures.size > 10_000) botFailures.clear(); // bounded memory
    const cur = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 60_000 };
    cur.count++;
    botFailures.set(request.ip, cur);
    throw errors.botKeyInvalid();
  }
}
