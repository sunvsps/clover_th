import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { PrismaClient } from '@prisma/client';
import Fastify, { type RouteOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Writable } from 'node:stream';
import type { Env } from './config/env.js';
import { createTx } from './lib/tx.js';
import activityRoutes from './modules/activities/routes.js';
import auctionRoutes from './modules/auctions/routes.js';
import auditRoutes from './modules/audit/routes.js';
import authRoutes from './modules/auth/routes.js';
import botRoutes from './modules/bot/routes.js';
import eventRoutes from './modules/events/routes.js';
import healthRoutes from './modules/health/routes.js';
import jobRoutes from './modules/jobs/routes.js';
import memberRoutes from './modules/members/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import plannerRoutes from './modules/planner/routes.js';
import registrationRoutes from './modules/registrations/routes.js';
import csrf from './plugins/csrf.js';
import errorHandler from './plugins/errorHandler.js';
import { genReqId, default as requestId } from './plugins/requestId.js';
import { requireAdmin } from './plugins/requireAdmin.js';
import session from './plugins/session.js';
import './types.js';

export type BuildOptions = {
  env: Env;
  prisma?: PrismaClient;
  /** Test hook: capture log lines. */
  logStream?: Writable;
  /** Test hook: called for every registered route (used by the authz matrix completeness check). */
  onRoute?: (route: RouteOptions) => void;
};

/** Strip query values (OAuth `code`, `state`) so they never reach the logs. */
const safeUrl = (url: string) => url.replace(/\?.*$/, (q) => (q.length > 1 ? '?[redacted]' : ''));

export async function buildApp(opts: BuildOptions) {
  const { env } = opts;
  const app = Fastify({
    genReqId,
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.LOG_LEVEL,
      ...(opts.logStream ? { stream: opts.logStream } : {}),
      // Belt and braces: our req serializer never emits headers, and these paths are censored anyway.
      redact: {
        paths: [
          'req.headers["x-bot-key"]',
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req) => ({ method: req.method, url: safeUrl(req.url), remoteAddress: req.ip }),
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  if (opts.onRoute) app.addHook('onRoute', opts.onRoute);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const prisma = opts.prisma ?? new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  app.decorate('env', env);
  app.decorate('botFailures', new Map());
  app.decorate('prisma', prisma);
  app.decorate(
    'tx',
    createTx(prisma, { maxWaitMs: env.PRISMA_TX_MAX_WAIT_MS, timeoutMs: env.PRISMA_TX_TIMEOUT_MS }),
  );
  app.addHook('onClose', async () => {
    if (!opts.prisma) await prisma.$disconnect();
  });

  await app.register(requestId);
  await app.register(errorHandler);
  await app.register(helmet);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Default budget for EVERY route (design 9): per member when signed in, per IP otherwise. It runs in preHandler so the
  // session is already resolved. Individual routes override it with config.rateLimit (login, bot, claim/release);
  // /healthz opts out. Failed authentication is limited separately (bot key guard, OAuth routes).
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: (req) => (req.auth ? env.RATE_LIMIT_AUTH_PER_MIN : env.RATE_LIMIT_ANON_PER_MIN),
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.memberId ?? req.ip,
  });
  await app.register(swagger, {
    openapi: { info: { title: 'Clover_TH API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  await app.register(csrf);
  await app.register(session);

  // API responses are per-user and must not be stored by shared caches (the polling endpoint sets no-cache + ETag itself).
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control'))
      reply.header('cache-control', 'no-store');
  });

  const docs =
    env.DOCS_ACCESS === 'auto' ? (env.NODE_ENV === 'production' ? 'off' : 'public') : env.DOCS_ACCESS;
  if (docs !== 'off') {
    app.get(
      '/docs/json',
      {
        schema: { hide: true },
        ...(docs === 'admin' ? { onRequest: [requireAdmin] } : {}),
      },
      async () => app.swagger(),
    );
  }

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(botRoutes);
  await app.register(auditRoutes);
  await app.register(memberRoutes);
  await app.register(jobRoutes);
  await app.register(notificationRoutes);
  await app.register(eventRoutes);
  await app.register(activityRoutes);
  await app.register(registrationRoutes);
  await app.register(plannerRoutes);
  await app.register(auctionRoutes);

  return app;
}
