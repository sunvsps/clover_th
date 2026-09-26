import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { AppError, errors } from '../../lib/errors.js';
import { safeString } from '../../lib/text.js';
import { endSession, startSession } from '../../plugins/session.js';
import { secureCookie } from '../../lib/cookies.js';
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
  /** UI language picked last; 'en' until the member switches it */
  language: z.enum(['en', 'th']),
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
    async (req, reply) => {
      const nonce = newNonce();
      reply.setCookie(STATE_COOKIE, `${nonce}.${Date.now()}`, {
        signed: true,
        httpOnly: true,
        secure: secureCookie(req),
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
        secure: secureCookie(req),
        sameSite: 'lax',
      });

      const unsigned = raw ? req.unsignCookie(raw) : null;
      const [nonce, issuedAt] = unsigned?.valid && unsigned.value ? unsigned.value.split('.') : [];
      const fresh = issuedAt !== undefined && Date.now() - Number(issuedAt) < STATE_TTL_MS;
      // A browser navigating here (Accept: text/html) must land back in the app, not on a raw JSON page (review M-6).
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (!nonce || !state || !fresh || !safeEq(nonce, state) || !consumeNonce(nonce)) {
        if (wantsHtml) return reply.redirect(frontend({ authError: 'AUTH_STATE_INVALID' }), 302);
        throw errors.oauthFailed('Missing, invalid or reused OAuth state');
      }
      if (error || !code) return reply.redirect(frontend({ authError: 'AUTH_OAUTH_FAILED' }), 302);

      let discordId: string;
      try {
        discordId = await fetchDiscordUserId(env, await exchangeCode(env, code));
      } catch (err) {
        if (wantsHtml && err instanceof AppError && err.code === 'AUTH_OAUTH_FAILED') {
          return reply.redirect(frontend({ authError: 'AUTH_OAUTH_FAILED' }), 302);
        }
        throw err;
      }
      const member = await app.prisma.member.findUnique({
        where: { discordId },
        select: { id: true, isActive: true },
      });
      if (!member) return reply.redirect(frontend({ authError: 'AUTH_NOT_REGISTERED' }), 302);
      if (!member.isActive) return reply.redirect(frontend({ authError: 'AUTH_MEMBER_INACTIVE' }), 302);

      await app.tx(async (tx) => {
        await startSession(tx, env, req, reply, member.id);
        await record(tx, {
          actorType: 'MEMBER',
          actorId: member.id,
          action: 'auth.login',
          entityType: 'member',
          entityId: member.id,
          requestId: req.id,
        }); // no token, ever
      });
      return reply.redirect(frontend(), 302);
    },
  );

  r.post(
    '/api/v1/auth/logout',
    { schema: { tags: ['auth'] }, onRequest: [requireAuth] },
    async (req, reply) => {
      await endSession(req, reply);
      await app.prisma.auditLog.create({
        data: {
          actorType: 'MEMBER',
          actorId: req.auth!.memberId,
          action: 'auth.logout',
          entityType: 'member',
          entityId: req.auth!.memberId,
          requestId: req.id,
        },
      });
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
        language: a.language,
        serverTime: new Date().toISOString(),
      };
    },
  );

  // Remembers the UI language the member picked last, so it follows them to another browser or device.
  r.put(
    '/api/v1/me/language',
    {
      schema: {
        tags: ['auth'],
        body: z.object({ language: z.enum(['en', 'th']) }).strict(),
        response: { 200: z.object({ language: z.enum(['en', 'th']) }) },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const { language } = req.body;
      await app.prisma.member.update({ where: { id: req.auth!.memberId }, data: { language } });
      return { language };
    },
  );
}
