import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { safeString } from '../../lib/text.js';
import { requireAdmin } from '../../plugins/requireAdmin.js';

const item = z.object({
  id: z.number(),
  at: z.string(),
  actorType: z.enum(['MEMBER', 'BOT', 'SYSTEM']),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  meta: z.unknown().nullable(),
  requestId: z.string().nullable(),
});

export default async function auditRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/admin/audit-log',
    {
      schema: {
        tags: ['admin'],
        querystring: z.object({
          cursor: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          actor: safeString(64).optional(),
          action: safeString(100).optional(),
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
        }),
        response: { 200: z.object({ items: z.array(item), nextCursor: z.number().nullable() }) },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const q = req.query;
      const where: Prisma.AuditLogWhereInput = {
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
        ...(q.actor ? { actorId: q.actor } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.from || q.to
          ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
          : {}),
      };
      const rows = await app.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1 });
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({ ...r, at: r.at.toISOString(), meta: r.meta ?? null })),
        nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
      };
    },
  );
}
