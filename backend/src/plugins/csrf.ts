import fp from 'fastify-plugin';
import { errors } from '../lib/errors.js';
import { isBotPath, sessionCookieName } from './session.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests only:
 * SameSite=Lax (cookie), a required X-Requested-With header, and an Origin check.
 * Bot-key routes are exempt (they never accept cookies).
 */
export default fp(
  async (app) => {
    const cookieName = sessionCookieName(app.env);
    const allowedOrigin = new URL(app.env.FRONTEND_URL).origin;

    app.addHook('onRequest', async (request) => {
      if (SAFE.has(request.method) || isBotPath(request.url)) return;
      if (!request.cookies[cookieName]) return;
      const xrw = request.headers['x-requested-with'];
      if (!xrw || (Array.isArray(xrw) ? xrw.length === 0 : xrw.trim() === '')) throw errors.csrfRejected();
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== allowedOrigin) throw errors.csrfRejected();
    });
  },
  { name: 'csrf', dependencies: ['@fastify/cookie'] },
);
