import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { safeString } from '../../lib/text.js';
import { requireAdmin } from '../../plugins/requireAdmin.js';

const status = z.enum(['PENDING', 'SENDING', 'SENT', 'DEAD']);
const item = z.object({
  id: z.number(),
  eventType: z.string(),
  target: z.enum(['DISCORD_DM', 'DISCORD_CHANNEL']),
  status,
  attempts: z.number(),
  maxAttempts: z.number(),
  nextAttemptAt: z.string(),
  lastError: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  /** Structured event data: names and ids only. */
  payload: z.unknown(),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export default async function notificationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/admin/notifications',
    {
      schema: {
        tags: ['notifications'],
        querystring: z.object({
          status: status.optional(),
          eventType: safeString(100).optional(),
          cursor: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: {
          200: z.object({
            items: z.array(item),
            counts: z.object({
              PENDING: z.number(),
              SENDING: z.number(),
              SENT: z.number(),
              DEAD: z.number(),
            }),
            nextCursor: z.number().nullable(),
          }),
        },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const q = req.query;
      const where: Prisma.NotificationOutboxWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.eventType ? { eventType: q.eventType } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      };
      const [rows, groups] = await Promise.all([
        app.prisma.notificationOutbox.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1 }),
        app.prisma.notificationOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      const page = rows.slice(0, q.limit);
      const counts = { PENDING: 0, SENDING: 0, SENT: 0, DEAD: 0 };
      for (const g of groups) counts[g.status] = g._count._all;
      return {
        items: page.map((n) => ({
          id: n.id,
          eventType: n.eventType,
          target: n.target,
          status: n.status,
          attempts: n.attempts,
          maxAttempts: n.maxAttempts,
          nextAttemptAt: n.nextAttemptAt.toISOString(),
          lastError: n.lastError,
          lastErrorCode: n.lastErrorCode,
          sentAt: iso(n.sentAt),
          createdAt: n.createdAt.toISOString(),
          entityType: n.entityType,
          entityId: n.entityId,
          payload: n.payload,
        })),
        counts,
        nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
      };
    },
  );

  // DEAD or PENDING goes back to PENDING now. A DEAD row gets a fresh attempt budget.
  r.post(
    '/api/v1/admin/notifications/:id/retry',
    {
      schema: {
        tags: ['notifications'],
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: z.object({ id: z.number(), status: z.literal('PENDING') }) },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      app.tx(async (tx) => {
        const rows = await tx.$queryRaw<{ id: number; status: string }[]>`
          SELECT id, status FROM "NotificationOutbox" WHERE id = ${req.params.id} FOR UPDATE`;
        const n = rows[0];
        if (!n) throw new AppError('NOT_FOUND', 404, 'Notification not found');
        if (n.status !== 'DEAD' && n.status !== 'PENDING') {
          throw new AppError(
            'NOTIFICATION_NOT_RETRYABLE',
            409,
            `A ${n.status} notification cannot be retried`,
          );
        }
        await tx.$executeRaw`UPDATE "NotificationOutbox"
          SET status = 'PENDING', attempts = CASE WHEN status = 'DEAD' THEN 0 ELSE attempts END,
              "nextAttemptAt" = clock_timestamp(), "lockedAt" = NULL, "updatedAt" = clock_timestamp()
          WHERE id = ${n.id}`;
        await record(tx, {
          actorType: 'MEMBER',
          actorId: req.auth!.memberId,
          action: 'notification.retry',
          entityType: 'notification',
          entityId: String(n.id),
          meta: { from: n.status },
          requestId: req.id,
        });
        return { id: n.id, status: 'PENDING' as const };
      }),
  );
}
