import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { isStaticRequest } from '../lib/staticPaths.js';

/**
 * Cheap per-IP request budget applied BEFORE the session lookup (design 9, security review M-1). The session lookup is
 * a database query and the main rate limiter runs after the auth guards, so without this an anonymous caller could
 * generate unmetered database load with garbage cookies or unknown routes. It is a plain in-memory counter (one
 * instance), generous on purpose (PREAUTH_LIMIT_PER_MIN, default 6000, about 100 requests a second per IP) so normal
 * traffic from many members behind one address is never affected; /healthz is exempt.
 */
export default fp(
  async (app) => {
    const limit = app.env.PREAUTH_LIMIT_PER_MIN;
    const windows = new Map<string, { count: number; resetAt: number }>();
    app.addHook('onRequest', async (request) => {
      if (request.url === '/healthz') return;
      // static files of the built frontend: a page load fetches many, they touch no database and cost nothing here
      if (app.frontend && isStaticRequest(request.method, request.url)) return;
      const now = Date.now();
      let w = windows.get(request.ip);
      if (!w || w.resetAt <= now) {
        if (windows.size > 20_000) windows.clear(); // bounded memory
        w = { count: 0, resetAt: now + 60_000 };
        windows.set(request.ip, w);
      }
      if (++w.count > limit) throw new AppError('RATE_LIMITED', 429, 'Too many requests');
    });
  },
  { name: 'preauth' },
);
