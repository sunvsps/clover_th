import { Prisma } from '@prisma/client';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, IGN_INDEX } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';

type Body = { error: { code: string; message: string; details: Record<string, unknown> } };
const body = (code: string, message: string, details: Record<string, unknown> = {}): Body => ({
  error: { code, message, details },
});

export default fp(
  async (app) => {
    app.setNotFoundHandler((request, reply) => {
      reply
        .status(404)
        .send(body('NOT_FOUND', `Route ${request.method} ${request.url.split('?')[0]} not found`));
    });

    app.setErrorHandler((err, request, reply) => {
      const send = (status: number, b: Body) => reply.status(status).send(b);

      if (err instanceof AppError) return send(err.status, body(err.code, err.message, err.details));

      if (hasZodFastifySchemaValidationErrors(err)) {
        return send(
          422,
          body('VALIDATION_ERROR', 'Request validation failed', {
            issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
          }),
        );
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (isUniqueViolation(err, ...IGN_INDEX)) {
          return send(409, body('DUPLICATE_IGN', 'In-game name is already used by an active member'));
        }
        if (err.code === 'P2002') return send(409, body('CONFLICT', 'Unique constraint violated'));
        if (err.code === 'P2003')
          return send(409, body('REFERENCE_CONFLICT', 'Row is referenced or reference is invalid'));
        if (err.code === 'P2028' || err.code === 'P2034') {
          return send(503, body('SERVICE_BUSY', 'Service busy, please retry'));
        }
      }

      const status = (err as { statusCode?: number }).statusCode;
      if (status === 429) return send(429, body('RATE_LIMITED', 'Too many requests'));
      if (typeof status === 'number' && status >= 400 && status < 500 && !isResponseSerializationError(err)) {
        return send(status, body('BAD_REQUEST', (err as Error).message));
      }

      request.log.error({ err }, 'unhandled error');
      return send(500, body('INTERNAL_ERROR', 'Unexpected server error'));
    });
  },
  { name: 'errorHandler' },
);
