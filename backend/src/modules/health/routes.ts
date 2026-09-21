import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/healthz',
    {
      config: { rateLimit: false }, // load balancers poll this
      schema: {
        tags: ['system'],
        response: { 200: z.object({ status: z.literal('ok'), db: z.literal('ok'), serverTime: z.string() }) },
      },
    },
    async () => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch (err) {
        app.log.error({ err }, 'health check: database unreachable');
        throw new AppError('DB_UNAVAILABLE', 503, 'Database unreachable');
      }
      return { status: 'ok' as const, db: 'ok' as const, serverTime: new Date().toISOString() };
    },
  );
}
