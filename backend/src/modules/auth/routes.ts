import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { safeString } from '../../lib/text.js';
import { endSession, startSession } from '../../plugins/session.js';
import { requireAuth } from '../../plugins/requireAdmin.js';
import { exchangeCode, fetchDiscordUserId } from './discord.js';
import { STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_MS, consumeNonce, newNonce } from './oauthState.js';

const profile = z.object({
  memberId: z.string(),
  discordId: z.string(),
  ign: z.string(),
  nickname: z.string().nullable(),
  job: z.object({ id: z.number(), label: z.string(), color: z.string() }),
  isAdmin: z.boolean(),
  isIncomplete: z.boolean(),
  serverTime: z.string(),
});

const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { env } = app;
  const frontend = (query?: Record<string, string>) => {
    const u = new URL('/', env.FRONTEND_URL);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.toString();
  };
  const authLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  // PKCE is not used: `state` is sufficient for a confidential server-side client (design 5, step 1).
  r.get(
    '/api/v1/auth/discord/login',
    { schema: { tags: ['auth'] }, config: authLimit },
    async (_req, reply) => {
      const nonce = newNonce();
      reply.setCookie(STATE_COOKIE, `${nonce}.${Date.now()}`, {
        signed: true,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: STATE_COOKIE_PATH,
        maxAge: STATE_TTL_MS / 1000,
      });
      const url = new URL('/oauth2/authorize', env.DISCORD_API_BASE);
      url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
      url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'identify');
      url.searchParams.set('state', nonce);
      return reply.redirect(url.toString(), 302);
    },
  );

  r.get(
    '/api/v1/auth/discord/callback',
    {
      schema: {
        tags: ['auth'],
        querystring: z.object({
          code: safeString(512).optional(),
          state: safeString(128).optional(),
          error: safeString(128, 0).optional(),
        }),
      },
      config: authLimit,
    },
    async (req, reply) => {
      const { code, state, error } = req.query;
      const raw = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, {
        path: STATE_COOKIE_PATH,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });

      const unsigned = raw ? req.unsignCookie(raw) : null;
      const [nonce, issuedAt] = unsigned?.valid && unsigned.value ? unsigned.value.split('.') : [];
      const fresh = issuedAt !== undefined && Date.now() - Number(issuedAt) < STATE_TTL_MS;
      if (!nonce || !state || !fresh || !safeEq(nonce, state) || !consumeNonce(nonce)) {
        throw errors.oauthFailed('Missing, invalid or reused OAuth state');
      }
      if (error || !code) return reply.redirect(frontend({ authError: 'AUTH_OAUTH_FAILED' }), 302);

      const discordId = await fetchDiscordUserId(env, await exchangeCode(env, code));
      const member = await app.prisma.member.findUnique({
        where: { discordId },
        select: { id: true, isActive: true },
      });
      if (!member) return reply.redirect(frontend({ authError: 'AUTH_NOT_REGISTERED' }), 302);
      if (!member.isActive) return reply.redirect(frontend({ authError: 'AUTH_MEMBER_INACTIVE' }), 302);

      await app.tx((tx) => startSession(tx, env, reply, member.id));
      return reply.redirect(frontend(), 302);
    },
  );

  r.post(
    '/api/v1/auth/logout',
    { schema: { tags: ['auth'] }, onRequest: [requireAuth] },
    async (req, reply) => {
      await endSession(req, reply);
      return reply.status(204).send();
    },
  );

  r.get(
    '/api/v1/me',
    { schema: { tags: ['auth'], response: { 200: profile } }, onRequest: [requireAuth] },
    async (req) => {
      const a = req.auth!;
      return {
        memberId: a.memberId,
        discordId: a.discordId,
        ign: a.ign,
        nickname: a.nickname,
        job: a.job,
        isAdmin: a.isAdmin,
        isIncomplete: a.nickname === null || a.source === 'MANUAL',
        serverTime: new Date().toISOString(),
      };
    },
  );
}
