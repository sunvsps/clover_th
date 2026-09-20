import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { Tx } from '../lib/tx.js';
import type { AuthContext } from '../types.js';

export const BOT_PREFIX = '/api/v1/bot/';
const SESSION_DAYS = 30;

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
    VALUES (${hashToken(token)}, ${memberId}::uuid, clock_timestamp() + make_interval(days => ${SESSION_DAYS}::int))`;
  reply.setCookie(sessionCookieName(env), token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
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

    app.addHook('onRequest', async (request) => {
      if (isBotPath(request.url)) return;
      const token = request.cookies[cookieName];
      if (!token || token.length > 200) return;
      const id = hashToken(token);
      const rows = await app.prisma.$queryRaw<Row[]>`
      SELECT s."expiresAt" > clock_timestamp() AS valid,
             clock_timestamp() - s."lastSeen" > interval '1 hour' AS stale,
             m."isActive", m.id AS "memberId", m."discordId", m.ign, m.nickname, m."isAdmin", m.source,
             j.id AS "jobId", j.label, j.color
      FROM "Session" s
      JOIN "Member" m ON m.id = s."memberId"
      JOIN "Job" j ON j.id = m."jobId"
      WHERE s.id = ${id}`;
      const r = rows[0];
      if (!r || !r.valid || !r.isActive) return;
      if (r.stale) {
        await app.prisma.$executeRaw`UPDATE "Session"
        SET "lastSeen" = clock_timestamp(), "expiresAt" = clock_timestamp() + make_interval(days => ${SESSION_DAYS}::int)
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
