import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { assertDevLoginAllowed } from '../../lib/devLogin.js';
import { AppError, errors } from '../../lib/errors.js';
import { secureCookie } from '../../lib/cookies.js';
import { sessionCookieName } from '../../plugins/session.js';

const DEMO_HOURS = 8; // like scripts/dev-login.ts
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The TCP peer only. X-Forwarded-For is deliberately ignored: a header can be forged, the socket address cannot. */
const isLoopbackPeer = (req: FastifyRequest) => LOOPBACK.has(req.socket.remoteAddress ?? '');

/**
 * LOCAL DEMO LOGIN. Registered ONLY when LOCAL_DEMO_ENABLED=true (never in production: the environment check refuses to
 * start). It lets a local demo sign in as a seeded member without a Discord application:
 *   GET  /api/v1/demo/members  the active members (id, discordId, ign, nickname, isAdmin), nothing else
 *   POST /api/v1/demo/login    {discordId} creates a normal session, like the OAuth callback does
 * Both answer 404 to any peer that is not loopback. When the flag is off these paths do not exist at all.
 */
export default async function demoRoutes(app: FastifyInstance) {
  const { env } = app;
  // Same guard as scripts/dev-login.ts: production, an https FRONTEND_URL or a non-local database refuse to start.
  assertDevLoginAllowed({
    NODE_ENV: env.NODE_ENV,
    FRONTEND_URL: env.FRONTEND_URL,
    DATABASE_URL: env.DATABASE_URL,
    DEV_LOGIN_ALLOW_REMOTE_DB: env.DEV_LOGIN_ALLOW_REMOTE_DB,
  });
  app.log.warn(
    'LOCAL_DEMO_ENABLED=true: anyone who can reach this server from THIS MACHINE can sign in as any member (including admins). Local demos only, never a real deployment.',
  );

  const r = app.withTypeProvider<ZodTypeProvider>();
  const notFound = (req: FastifyRequest) =>
    new AppError('NOT_FOUND', 404, `Route ${req.method} ${req.url.split('?')[0]} not found`);
  const loopbackOnly = async (req: FastifyRequest) => {
    if (!isLoopbackPeer(req)) throw notFound(req);
  };
  const limit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  r.get(
    '/api/v1/demo/members',
    {
      schema: {
        tags: ['demo'],
        response: {
          200: z.array(
            z.object({
              memberId: z.string(),
              discordId: z.string(),
              ign: z.string(),
              nickname: z.string().nullable(),
              isAdmin: z.boolean(),
            }),
          ),
        },
      },
      onRequest: [loopbackOnly],
      config: limit,
    },
    async () => {
      const rows = await app.prisma.member.findMany({
        where: { isActive: true },
        select: { id: true, discordId: true, ign: true, nickname: true, isAdmin: true },
        orderBy: [{ isAdmin: 'desc' }, { ign: 'asc' }],
      });
      return rows.map((m) => ({
        memberId: m.id,
        discordId: m.discordId,
        ign: m.ign,
        nickname: m.nickname,
        isAdmin: m.isAdmin,
      }));
    },
  );

  const allowedOrigin = new URL(env.FRONTEND_URL).origin;
  r.post(
    '/api/v1/demo/login',
    {
      schema: { tags: ['demo'], body: z.object({ discordId: z.string().regex(/^\d{1,25}$/) }).strict() },
      onRequest: [
        loopbackOnly,
        async (req) => {
          // CSRF, as for every cookie write: a custom header a cross-site form cannot send, and the Origin when present
          const xrw = req.headers['x-requested-with'];
          const origin = req.headers.origin;
          if (
            !xrw ||
            (Array.isArray(xrw) ? xrw.length === 0 : xrw.trim() === '') ||
            (origin !== undefined && origin !== allowedOrigin)
          )
            throw errors.csrfRejected();
        },
      ],
      config: limit,
    },
    async (req, reply) => {
      const member = await app.prisma.member.findUnique({
        where: { discordId: req.body.discordId },
        select: { id: true, isActive: true },
      });
      // unknown and deactivated members get the same answer as the OAuth callback gives them
      if (!member || !member.isActive)
        throw new AppError('AUTH_NOT_REGISTERED', 403, 'This account is not registered');
      const token = randomBytes(32).toString('base64url');
      await app.tx(async (tx) => {
        await tx.$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt")
          VALUES (${createHash('sha256').update(token).digest('hex')}, ${member.id}::uuid,
                  clock_timestamp() + make_interval(hours => ${DEMO_HOURS}::int))`;
        await record(tx, {
          actorType: 'MEMBER',
          actorId: member.id,
          action: 'auth.demo_login',
          entityType: 'member',
          entityId: member.id,
          requestId: req.id,
        }); // never the token
      });
      reply.setCookie(sessionCookieName(env), token, {
        httpOnly: true,
        // The cookie the OAuth login sets is Secure. This route only answers loopback, i.e. http://localhost, where
        // Safari refuses Secure cookies; it is marked Secure only when the request really came in over https.
        secure: secureCookie(req),
        sameSite: 'lax',
        path: '/',
        maxAge: DEMO_HOURS * 3600,
      });
      return reply.status(204).send();
    },
  );
}
