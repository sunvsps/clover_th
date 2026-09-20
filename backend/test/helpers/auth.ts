import type { FastifyInstance } from 'fastify';
import type { MockDiscord } from './mockDiscord.js';

let n = 0;

/** Runs the real login + callback flow against the mock Discord and returns the session cookie header. */
export async function loginAs(app: FastifyInstance, mock: MockDiscord, discordId: string) {
  const login = await app.inject({ method: 'GET', url: '/api/v1/auth/discord/login' });
  const state = new URL(login.headers.location as string).searchParams.get('state')!;
  const stateCookie = login.cookies.find((c) => c.name === 'oauth_state')!;
  const code = `code-${++n}`;
  mock.registerCode(code, discordId);
  const cb = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/discord/callback?code=${code}&state=${state}`,
    cookies: { oauth_state: stateCookie.value },
  });
  const session = cb.cookies.find((c) => c.name === 'session');
  return { cb, cookie: session ? `session=${session.value}` : null, state, stateCookie: stateCookie.value };
}
