import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';

/** Reuse a sane incoming X-Request-Id, otherwise generate one. */
export const genReqId = (req: { headers: Record<string, string | string[] | undefined> }) => {
  const h = req.headers['x-request-id'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : randomUUID();
};

export default fp(
  async (app) => {
    app.addHook('onRequest', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  },
  { name: 'requestId' },
);
