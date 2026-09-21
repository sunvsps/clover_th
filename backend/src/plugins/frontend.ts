import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';

/**
 * ../frontend/dist next to the backend, whatever the working directory is and whether the code runs from src/ (tsx) or
 * from the compiled dist/src/ (one directory deeper).
 */
const DEFAULT_DIST_CANDIDATES = ['../../../frontend/dist', '../../../../frontend/dist'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
);
const DEFAULT_DIST =
  DEFAULT_DIST_CANDIDATES.find((d) => existsSync(resolve(d, 'index.html'))) ?? DEFAULT_DIST_CANDIDATES[0]!;

/**
 * Serves the built frontend from this process, so one origin gives both the site and the API.
 * Enabled by SERVE_FRONTEND (auto: only when the dist directory holds an index.html). Static files never touch the
 * database: the session, pre-auth and rate-limit hooks skip them (see isStaticRequest). Unknown API paths keep the JSON
 * 404 envelope; client-side routes (no file extension, Accept: text/html) get index.html; a missing asset is a 404.
 */
export default fp(
  async (app) => {
    const mode = app.env.SERVE_FRONTEND;
    if (mode === 'off') return;
    const root = app.env.FRONTEND_DIST_DIR ? resolve(app.env.FRONTEND_DIST_DIR) : DEFAULT_DIST;
    if (!existsSync(resolve(root, 'index.html'))) {
      if (mode === 'on')
        throw new Error(`SERVE_FRONTEND=on but ${root}/index.html does not exist (build the frontend first)`);
      app.log.info({ root }, 'no built frontend found: serving the API only');
      return;
    }

    await app.register(fastifyStatic, {
      root,
      prefix: '/',
      wildcard: false, // one route per built file: no catch-all that could shadow an API path
      index: false,
      cacheControl: false,
      dotfiles: 'ignore',
      setHeaders(res, path) {
        // content-hashed build output never changes under its name; everything else must be revalidated
        if (/[\\/]assets[\\/]/.test(path))
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else if (path.endsWith('index.html')) res.setHeader('cache-control', 'no-cache');
        else res.setHeader('cache-control', 'public, max-age=3600');
      },
    });

    const serveIndex = (reply: Parameters<NonNullable<typeof app.frontend>['serveIndex']>[0]) =>
      reply.code(200).sendFile('index.html');
    app.frontend = { serveIndex };
    app.get('/', { schema: { hide: true }, config: { rateLimit: false } }, async (_req, reply) =>
      serveIndex(reply),
    );
    app.log.info({ root }, 'serving the built frontend');
  },
  { name: 'frontend' },
);
