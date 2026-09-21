import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { isStaticRequest } from '../lib/staticPaths.js';
import type { Tx } from '../lib/tx.js';
import type { AuthContext } from '../types.js';

export const BOT_PREFIX = '/api/v1/bot/';

export const sessionCookieName = (env: Env) => (env.NODE_ENV === 'production' ? '__Host-session' : 'session');
export const isBotPath = (url: string) => url.split('?')[0]!.startsWith(BOT_PREFIX);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Row = {
  valid: boolean;
  stale: boolean;
  isActive: boolean;
  memberId: string;
  discordId: string;
  ign: string;
  nickname: string | null;
  isAdmin: boolean;
  source: 'BOT' | 'MANUAL';
  jobId: number;
  label: string;
  color: string;
};

/**
 * Creates a session and sets the cookie. Expiry is computed DB-side (clock_timestamp()).
 * The cookie holds a random token; the DB stores only its sha256 as the session id.
 */
export async function startSession(tx: Tx, env: Env, reply: FastifyReply, memberId: string) {
  const token = randomBytes(32).toString('base64url');
  await tx.$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt")
    VALUES (${hashToken(token)}, ${memberId}::uuid,
            clock_timestamp() + make_interval(days => ${env.SESSION_SLIDING_DAYS}::int))`;
  reply.setCookie(sessionCookieName(env), token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_SLIDING_DAYS * 86400,
  });
}

export async function endSession(request: FastifyRequest, reply: FastifyReply) {
  if (request.auth) await request.server.prisma.session.deleteMany({ where: { id: request.auth.sessionId } });
  reply.clearCookie(sessionCookieName(request.server.env), {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

/**
 * Resolves the session on every request straight from the DB (no cache), so admin and
 * deactivation changes are immediate. lastSeen/expiresAt are refreshed at most once per hour.
 * Bot routes never look at cookies.
 */
export default fp(
  async (app) => {
    app.decorateRequest('auth', null);
    const cookieName = sessionCookieName(app.env);
    const sliding = app.env.SESSION_SLIDING_DAYS;
    const absolute = app.env.SESSION_ABSOLUTE_DAYS;
    // Tokens that matched no session row. A random token that does not exist cannot become valid later, so repeating
    // the same garbage cookie costs no further database queries. (Expired/inactive states are NOT cached: they can
    // change, e.g. on reactivation.)
    const unknownTokens = new Map<string, number>();

    app.addHook('onRequest', async (request) => {
      if (isBotPath(request.url)) return;
      if (app.frontend && isStaticRequest(request.method, request.url)) return; // static files never look up a session
      const token = request.cookies[cookieName];
      if (!token || token.length > 200) return;
      const id = hashToken(token);
      const until = unknownTokens.get(id);
      if (until !== undefined && until > Date.now()) return;
      const rows = await app.prisma.$queryRaw<Row[]>`
      SELECT s."expiresAt" > clock_timestamp()
               AND s."createdAt" + make_interval(days => ${absolute}::int) > clock_timestamp() AS valid,
             clock_timestamp() - s."lastSeen" > interval '1 hour' AS stale,
             m."isActive", m.id AS "memberId", m."discordId", m.ign, m.nickname, m."isAdmin", m.source,
             j.id AS "jobId", j.label, j.color
      FROM "Session" s
      JOIN "Member" m ON m.id = s."memberId"
      JOIN "Job" j ON j.id = m."jobId"
      WHERE s.id = ${id}`;
      const r = rows[0];
      if (!r) {
        if (unknownTokens.size > 5000) unknownTokens.clear();
        unknownTokens.set(id, Date.now() + 30_000);
        return;
      }
      if (!r.valid || !r.isActive) return;
      if (r.stale) {
        await app.prisma.$executeRaw`UPDATE "Session"
        SET "lastSeen" = clock_timestamp(),
            "expiresAt" = LEAST(clock_timestamp() + make_interval(days => ${sliding}::int),
                                "createdAt" + make_interval(days => ${absolute}::int))
        WHERE id = ${id}`;
      }
      const auth: AuthContext = {
        sessionId: id,
        memberId: r.memberId,
        discordId: r.discordId,
        ign: r.ign,
        nickname: r.nickname,
        isAdmin: r.isAdmin,
        source: r.source,
        job: { id: r.jobId, label: r.label, color: r.color },
      };
      request.auth = auth;
    });
  },
  { name: 'session', dependencies: ['@fastify/cookie'] },
);
