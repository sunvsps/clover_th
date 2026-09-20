import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { withActivityLock } from '../../lib/locks.js';
import { findEvent, getOrCreateOccurrence } from '../../lib/occurrence.js';
import { daysBetween, isValidDateStr, withinWindow } from '../../lib/time.js';
import { safeString } from '../../lib/text.js';
import { requireAuth } from '../../plugins/requireAdmin.js';
import { setRegistration } from './service.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const status = z.enum(['JOINED', 'WAITLISTED', 'LEAVE']);

const putResponse = z.object({
  status: z.enum(['JOINED', 'WAITLISTED', 'LEAVE', 'NONE']),
  waitlistPosition: z.number().nullable(),
  promoted: z.array(z.string()),
  /** Planner backfills; always empty until the planner packages land. */
  backfilled: z.array(
    z.object({
      teamId: z.number(),
      teamName: z.string(),
      slot: z.number(),
      vacatedMemberId: z.string(),
      promotedMemberId: z.string(),
      reason: z.enum(['UNREGISTERED', 'LEAVE', 'DEACTIVATED']),
    }),
  ),
  planVersion: z.number(),
});

const regItem = z.object({
  memberId: z.string(),
  status,
  waitlistPos: z.number().optional(),
  /** Planner activities only: whether the member holds a slot. */
  placed: z.boolean().optional(),
  /** Planner activities only: 1-based reserve order (JOINED and unplaced), else null. */
  reserveOrder: z.number().nullable().optional(),
});

type Row = {
  eventId: string;
  date: string;
  memberId: string;
  status: 'JOINED' | 'WAITLISTED' | 'LEAVE';
  hasPlanner: boolean;
  placed: boolean;
  waitlistPos: number | null;
  reserveOrder: number | null;
};

export default async function registrationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.put(
    '/api/v1/events/:eventId/occurrences/:date/registrations/:memberId',
    {
      schema: {
        tags: ['registrations'],
        params: z.object({
          eventId: safeString(100),
          date: dateStr,
          memberId: z.union([z.literal('me'), z.uuid()]),
        }),
        body: z.object({ status: z.enum(['JOINED', 'LEAVE', 'NONE']) }).strict(),
        response: { 200: putResponse },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const auth = req.auth!;
      const target = req.params.memberId === 'me' ? auth.memberId : req.params.memberId;
      if (target !== auth.memberId && !auth.isAdmin) {
        throw new AppError('FORBIDDEN_OTHER_MEMBER', 403, 'Only an admin may change another member');
      }
      const { eventId, date } = req.params;
      // The activity id comes from the event; the lock is taken before ANY occurrence read or write.
      const ev = await findEvent(app.prisma, eventId);
      return app.tx(async (tx) => {
        await withActivityLock(tx, ev.activityId);
        const occurrence = await getOrCreateOccurrence(tx, eventId, date);
        return setRegistration(tx, {
          occurrence,
          memberId: target,
          requested: req.body.status,
          actor: { memberId: auth.memberId, isAdmin: auth.isAdmin },
          requestId: req.id,
          notifications: app.env.NOTIFICATIONS_PROVIDER,
        });
      });
    },
  );

  // Range read (max 14 days). Never creates occurrences: an occurrence without rows simply has no entry.
  r.get(
    '/api/v1/registrations',
    {
      schema: {
        tags: ['registrations'],
        querystring: z.object({ from: dateStr, to: dateStr }),
        response: {
          200: z.object({
            from: z.string(),
            to: z.string(),
            serverTime: z.string(),
            /** Keyed "YYYY-MM-DD:eventId", like the frontend attendance object. */
            occurrences: z.record(z.string(), z.array(regItem)),
          }),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const { from, to } = req.query;
      if (!isValidDateStr(from) || !isValidDateStr(to) || to < from) {
        throw new AppError('VALIDATION_ERROR', 422, 'from/to must be valid dates with from <= to');
      }
      if (daysBetween(from, to) + 1 > 14)
        throw new AppError('VALIDATION_ERROR', 422, 'The range is limited to 14 days');
      if (!withinWindow(from) || !withinWindow(to)) {
        throw new AppError('INVALID_OCCURRENCE_DATE', 422, 'The range is out of the supported window');
      }
      const rows = await app.prisma.$queryRaw<Row[]>`
        SELECT o."eventId", to_char(o.date, 'YYYY-MM-DD') AS date, r."memberId", r.status, a."hasPlanner",
               (p.id IS NOT NULL) AS placed,
               CASE WHEN r.status = 'WAITLISTED' THEN
                 (SELECT count(*)::int + 1 FROM "Registration" w WHERE w."occurrenceId" = o.id AND w.status = 'WAITLISTED'
                    AND (w."registeredAt", w.id) < (r."registeredAt", r.id)) END AS "waitlistPos",
               CASE WHEN a."hasPlanner" AND r.status = 'JOINED' AND p.id IS NULL THEN
                 (SELECT count(*)::int + 1 FROM "Registration" j
                    WHERE j."occurrenceId" = o.id AND j.status = 'JOINED'
                      AND NOT EXISTS (SELECT 1 FROM "Placement" pj WHERE pj."occurrenceId" = o.id AND pj."memberId" = j."memberId")
                      AND (j."registeredAt", j.id) < (r."registeredAt", r.id)) END AS "reserveOrder"
        FROM "Occurrence" o
        JOIN "ScheduleEvent" e ON e.id = o."eventId"
        JOIN "Activity" a ON a.id = e."activityId"
        JOIN "Registration" r ON r."occurrenceId" = o.id
        LEFT JOIN "Placement" p ON p."occurrenceId" = o.id AND p."memberId" = r."memberId"
        WHERE o.date BETWEEN ${from}::date AND ${to}::date
        ORDER BY o.date, o."eventId", r."registeredAt", r.id`;
      const occurrences: Record<string, z.infer<typeof regItem>[]> = {};
      for (const x of rows) {
        (occurrences[`${x.date}:${x.eventId}`] ??= []).push({
          memberId: x.memberId,
          status: x.status,
          ...(x.waitlistPos !== null ? { waitlistPos: x.waitlistPos } : {}),
          ...(x.hasPlanner ? { placed: x.placed, reserveOrder: x.reserveOrder } : {}),
        });
      }
      return { from, to, serverTime: new Date().toISOString(), occurrences };
    },
  );
}
