import type { Env } from '../../config/env.js';
import { errors } from '../../lib/errors.js';

const TIMEOUT_MS = 5000;

/** Exchanges the authorization code for a token. Tokens are used once and discarded, never logged. */
export async function exchangeCode(env: Env, code: string): Promise<string> {
  const res = await fetch(`${env.DISCORD_API_BASE}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) throw errors.oauthFailed();
  const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!json || typeof json.access_token !== 'string' || !json.access_token) throw errors.oauthFailed();
  return json.access_token;
}

/** Returns the Discord user id (a snowflake, kept as a string). */
export async function fetchDiscordUserId(env: Env, accessToken: string): Promise<string> {
  const res = await fetch(`${env.DISCORD_API_BASE}/api/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) throw errors.oauthFailed();
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!json || typeof json.id !== 'string' || !/^\d{1,25}$/.test(json.id)) throw errors.oauthFailed();
  return json.id;
}
