import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { BOT_KEY, CSRF } from '../helpers/app.js';

/**
 * Authorization matrix harness (design WP3). Every route of every WP registers itself in
 * test/authz/routes.ts with its auth type; the harness asserts the guards, and that no route
 * exists without an entry (completeness).
 *   public: no auth   member: any signed-in member   admin: admin only   bot: bot key only
 */
export type AuthKind = 'public' | 'member' | 'admin' | 'bot';
export type RouteSpec = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Route pattern exactly as registered (e.g. /api/v1/bot/members/:discordId). */
  pattern: string;
  /** Concrete URL used for requests. */
  url: string;
  auth: AuthKind;
  payload?: object;
};

export type MatrixCtx = {
  app: FastifyInstance;
  memberCookie: string;
  adminCookie: string;
  /** Fresh sessions for tests that pass the guards (a route such as logout destroys its session). */
  freshMember: () => Promise<string>;
  freshAdmin: () => Promise<string>;
};

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const req = (ctx: MatrixCtx, s: RouteSpec, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: s.method, url: s.url, headers, ...(s.payload ? { payload: s.payload } : {}) });
const codeOf = (r: { body: string }) => {
  try {
    return JSON.parse(r.body)?.error?.code as string | undefined;
  } catch {
    return undefined;
  }
};
const notAuthError = (r: { statusCode: number; body: string }) => {
  expect(['AUTH_REQUIRED', 'ADMIN_REQUIRED', 'BOT_KEY_INVALID', 'CSRF_REJECTED']).not.toContain(codeOf(r));
};

export function runMatrix(specs: RouteSpec[], getCtx: () => MatrixCtx) {
  for (const s of specs) {
    describe(`${s.method} ${s.pattern} [${s.auth}]`, () => {
      if (s.auth === 'public') {
        it('needs no credentials', async () => {
          const r = await req(getCtx(), s);
          expect(['AUTH_REQUIRED', 'ADMIN_REQUIRED', 'BOT_KEY_INVALID']).not.toContain(codeOf(r));
        });
      }

      if (s.auth === 'member' || s.auth === 'admin') {
        it('no credentials -> AUTH_REQUIRED 401', async () => {
          const r = await req(getCtx(), s);
          expect(r.statusCode).toBe(401);
          expect(codeOf(r)).toBe('AUTH_REQUIRED');
        });
        it('bot key is not accepted on member routes', async () => {
          const r = await req(getCtx(), s, { 'x-bot-key': BOT_KEY });
          expect(r.statusCode).toBe(401);
          expect(codeOf(r)).toBe('AUTH_REQUIRED');
        });
        it('invalid cookie -> AUTH_REQUIRED', async () => {
          const r = await req(getCtx(), s, { cookie: 'session=not-a-real-session', ...CSRF });
          expect(codeOf(r)).toBe('AUTH_REQUIRED');
        });
        if (WRITE.has(s.method)) {
          it('cookie write without the CSRF header -> CSRF_REJECTED 403', async () => {
            const c = getCtx();
            const r = await req(c, s, { cookie: s.auth === 'admin' ? c.adminCookie : c.memberCookie });
            expect(r.statusCode).toBe(403);
            expect(codeOf(r)).toBe('CSRF_REJECTED');
          });
        }
      }

      if (s.auth === 'admin') {
        it('non-admin member -> ADMIN_REQUIRED 403', async () => {
          const c = getCtx();
          const r = await req(c, s, { cookie: c.memberCookie, ...CSRF });
          expect(r.statusCode).toBe(403);
          expect(codeOf(r)).toBe('ADMIN_REQUIRED');
        });
        it('admin passes the guards', async () => {
          const c = getCtx();
          notAuthError(await req(c, s, { cookie: await c.freshAdmin(), ...CSRF }));
        });
      }

      if (s.auth === 'member') {
        it('a member passes the guards', async () => {
          const c = getCtx();
          notAuthError(await req(c, s, { cookie: await c.freshMember(), ...CSRF }));
        });
      }

      if (s.auth === 'bot') {
        it('missing or wrong key -> BOT_KEY_INVALID 401', async () => {
          for (const h of [{}, { 'x-bot-key': 'wrong' }] as Record<string, string>[]) {
            const r = await req(getCtx(), s, h);
            expect(r.statusCode).toBe(401);
            expect(codeOf(r)).toBe('BOT_KEY_INVALID');
          }
        });
        it('session cookies (member or admin) are not accepted on bot routes', async () => {
          const c = getCtx();
          for (const cookie of [c.memberCookie, c.adminCookie]) {
            const r = await req(c, s, { cookie, ...CSRF });
            expect(r.statusCode).toBe(401);
            expect(codeOf(r)).toBe('BOT_KEY_INVALID');
          }
        });
        it('the bot key works without CSRF header or Origin', async () => {
          notAuthError(await req(getCtx(), s, { 'x-bot-key': BOT_KEY }));
        });
      }
    });
  }
}

/** Every real route must have a matrix entry, and every entry must be a real route. */
export function assertComplete(registered: { method: string; url: string }[], specs: RouteSpec[]) {
  const have = new Set(registered.map((r) => `${r.method} ${r.url}`));
  const want = new Set(specs.map((s) => `${s.method} ${s.pattern}`));
  expect(
    [...have].filter((x) => !want.has(x)),
    'routes missing from the authz matrix',
  ).toEqual([]);
  expect(
    [...want].filter((x) => !have.has(x)),
    'matrix entries with no route',
  ).toEqual([]);
}
