import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { withActivityLock } from '../../lib/locks.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';
import { promoteWaitlist } from '../registrations/service.js';

const activityOut = z.object({
  id: z.string(),
  name: z.string(),
  isGuild: z.boolean(),
  hasPlanner: z.boolean(),
  registrationCapacity: z.number().nullable(),
  autoBackfill: z.boolean(),
  /** Admin only: omitted for other members. */
  notifyChannelId: z.string().nullable().optional(),
  /** Sum of non-archived team sizes over non-archived rooms. */
  layoutCapacity: z.number(),
});

const patchBody = z
  .object({
    registrationCapacity: z.number().int().min(1).max(100000).nullable().optional(),
    autoBackfill: z.boolean().optional(),
    notifyChannelId: z
      .string()
      .regex(/^\d{5,25}$/, 'must be a Discord channel id (digits)')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'provide at least one field' });

type Row = {
  id: string;
  name: string;
  isGuild: boolean;
  hasPlanner: boolean;
  registrationCapacity: number | null;
  autoBackfill: boolean;
  notifyChannelId: string | null;
  layoutCapacity: number;
};

export default async function activityRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const list = async (admin: boolean, id?: string) => {
    const rows = await app.prisma.$queryRaw<Row[]>`
      SELECT a.id, a.name, a."isGuild", a."hasPlanner", a."registrationCapacity", a."autoBackfill", a."notifyChannelId",
             COALESCE((SELECT SUM(t.size) FROM "Room" rm JOIN "Team" t ON t."roomId" = rm.id
                       WHERE rm."activityId" = a.id AND rm."archivedAt" IS NULL AND t."archivedAt" IS NULL), 0)::int AS "layoutCapacity"
      FROM "Activity" a
      WHERE (${id ?? null}::text IS NULL OR a.id = ${id ?? null}::text)
      ORDER BY a."sortOrder", a.id`;
    return rows.map(({ notifyChannelId, ...rest }) => (admin ? { ...rest, notifyChannelId } : rest));
  };

  r.get(
    '/api/v1/activities',
    { schema: { tags: ['schedule'], response: { 200: z.array(activityOut) } }, onRequest: [requireAuth] },
    async (req) => list(req.auth!.isAdmin),
  );

  // Runs under the Activity lock, so it serializes with every registration write (including ones that would
  // lazily create an occurrence). Raising or removing the capacity promotes waitlisted members across all
  // future occurrences with a waitlist; lowering never demotes.
  r.patch(
    '/api/v1/admin/activities/:id',
    {
      schema: {
        tags: ['schedule'],
        params: z.object({ id: z.string().min(1).max(100) }),
        body: patchBody,
        response: {
          200: z.object({
            activity: activityOut,
            promoted: z.array(z.object({ occurrenceId: z.number(), memberId: z.string() })),
          }),
        },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const { id } = req.params;
      const b = req.body;
      const promoted: { occurrenceId: number; memberId: string }[] = [];
      await app.tx(async (tx) => {
        await withActivityLock(tx, id);
        const [before] = await tx.$queryRaw<
          {
            registrationCapacity: number | null;
            autoBackfill: boolean;
            notifyChannelId: string | null;
            hasPlanner: boolean;
          }[]
        >`SELECT "registrationCapacity", "autoBackfill", "notifyChannelId", "hasPlanner" FROM "Activity" WHERE id = ${id}`;
        const next = {
          registrationCapacity:
            b.registrationCapacity !== undefined ? b.registrationCapacity : before!.registrationCapacity,
          autoBackfill: b.autoBackfill ?? before!.autoBackfill,
          notifyChannelId: b.notifyChannelId !== undefined ? b.notifyChannelId : before!.notifyChannelId,
        };
        if (next.autoBackfill && !before!.hasPlanner) {
          throw new AppError(
            'AUTO_BACKFILL_REQUIRES_PLANNER',
            422,
            'Auto-backfill needs an activity with a planner',
          );
        }
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const k of Object.keys(next) as (keyof typeof next)[]) {
          if (next[k] !== before![k]) changes[k] = { from: before![k], to: next[k] };
        }
        if (Object.keys(changes).length === 0) return;
        await tx.activity.update({ where: { id }, data: next });
        await record(tx, {
          actorType: 'MEMBER',
          actorId: req.auth!.memberId,
          action: 'activity.update',
          entityType: 'activity',
          entityId: id,
          meta: { changes } as never,
          requestId: req.id,
        });
        const cap = next.registrationCapacity;
        const raised =
          'registrationCapacity' in changes && (cap === null || cap > (before!.registrationCapacity ?? 0));
        if (raised) {
          const occs = await tx.$queryRaw<{ id: number }[]>`
            SELECT o.id FROM "Occurrence" o JOIN "ScheduleEvent" e ON e.id = o."eventId"
            WHERE e."activityId" = ${id} AND o."startsAt" > clock_timestamp()
              AND EXISTS (SELECT 1 FROM "Registration" r WHERE r."occurrenceId" = o.id AND r.status = 'WAITLISTED')
            ORDER BY o.id`;
          for (const o of occs) {
            for (const memberId of await promoteWaitlist(tx, o.id, cap)) {
              promoted.push({ occurrenceId: o.id, memberId });
              await record(tx, {
                actorType: 'SYSTEM',
                action: 'registration.promote',
                entityType: 'occurrence',
                entityId: String(o.id),
                meta: { memberId, reason: 'CAPACITY_RAISED' },
                requestId: req.id,
              });
            }
          }
        }
      });
      const [activity] = await list(true, id);
      return { activity: activity!, promoted };
    },
  );
}
