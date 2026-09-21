import { randomBytes } from 'node:crypto';

export const STATE_COOKIE = 'oauth_state';
export const STATE_COOKIE_PATH = '/api/v1/auth/discord';
export const STATE_TTL_MS = 10 * 60 * 1000;

export const newNonce = () => randomBytes(16).toString('hex');

/**
 * Single-use guard: a state nonce that was already consumed is rejected even if the signed cookie
 * is replayed. In memory is fine for one API instance (design 3.5).
 */
const consumed = new Map<string, number>();

export function consumeNonce(nonce: string, now = Date.now()): boolean {
  for (const [k, exp] of consumed) if (exp <= now) consumed.delete(k);
  if (consumed.has(nonce)) return false;
  consumed.set(nonce, now + STATE_TTL_MS);
  return true;
}
