import type { FastifyRequest } from 'fastify';
import { verifyBotKey } from '../lib/botKey.js';
import { errors } from '../lib/errors.js';

/** onRequest guard for bot routes: header X-Bot-Key hashed and compared to BOT_API_KEYS digests. */
export async function requireBotKey(request: FastifyRequest) {
  const h = request.headers['x-bot-key'];
  const key = Array.isArray(h) ? h[0] : h;
  if (!key || key.length > 256 || !verifyBotKey(key, request.server.env.BOT_API_KEYS))
    throw errors.botKeyInvalid();
}
