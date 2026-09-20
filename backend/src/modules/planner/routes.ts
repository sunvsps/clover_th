import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withActivityLock } from '../../lib/locks.js';
import {
  assertOccurrenceDate,
  findEvent,
  getOrCreateOccurrence,
  readOccurrence,
} from '../../lib/occurrence.js';
import { nameField, safeString } from '../../lib/text.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';
import { copyFromPrevious } from './copy.js';
import { assertPlanner, readLayout, replaceLayout } from './layout.js';
import { assertVersion, buildPlan, clearPlan, placeMember } from './plan.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const occParams = z.object({ eventId: safeString(100), date: dateStr });
const version = z.number().int().min(0);

const layoutOut = z.object({
  activityId: z.string(),
  rooms: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      name: z.string(),
      sortOrder: z.number(),
      capacity: z.number(),
      teams: z.array(z.object({ id: z.number(), name: z.string(), size: z.number(), sortOrder: z.number() })),
    }),
  ),
});

const layoutBody = z
  .object({
    rooms: z
      .array(
        z
          .object({
            id: z.number().int().positive().optional(),
            key: z.string().regex(/^[a-z0-9_-]{1,32}$/, 'key must be 1-32 chars of a-z 0-9 _ -'),
            name: nameField(64),
            teams: z
              .array(
                z
                  .object({
                    id: z.number().int().positive().optional(),
                    name: nameField(64),
                    size: z.number().int().min(1).max(50),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const placement = z.object({
  memberId: z.string(),
  slot: z.number(),
  regStatus: z.enum(['JOINED', 'WAITLISTED', 'LEAVE', 'NONE']),
  source: z.enum(['ADMIN', 'COPY', 'AUTO_BACKFILL']),
  backfill: z
    .object({ vacatedMemberId: z.string().nullable(), reason: z.string().nullable(), at: z.string() })
    .optional(),
});
const planOut = z.object({
  eventId: z.string(),
  date: z.string(),
  startsAt: z.string().nullable(),
  version: z.number(),
  autoBackfill: z.boolean(),
  rooms: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      name: z.string(),
      archived: z.boolean(),
      capacity: z.number(),
      teams: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          size: z.number(),
          archived: z.boolean(),
          placements: z.array(placement),
        }),
      ),
    }),
  ),
  reserves: z.array(z.object({ memberId: z.string(), registeredAt: z.string(), order: z.number() })),
});

export default async function plannerRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const activityParams = z.object({ id: safeString(100) });

  r.get(
    '/api/v1/admin/activities/:id/layout',
    {
      schema: { tags: ['planner'], params: activityParams, response: { 200: layoutOut } },
      onRequest: [requireAdmin],
    },
    async (req) => {
      await assertPlanner(app.prisma, req.params.id);
      return readLayout(app.prisma, req.params.id);
    },
  );

  r.put(
    '/api/v1/admin/activities/:id/layout',
    {
      schema: { tags: ['planner'], params: activityParams, body: layoutBody, response: { 200: layoutOut } },
      onRequest: [requireAdmin],
    },
    async (req) =>
      app.tx((tx) =>
        replaceLayout(tx, req.params.id, req.body.rooms, { memberId: req.auth!.memberId }, req.id),
      ),
  );

  // Everyone signed in can read a plan. Reads never create occurrences.
  r.get(
    '/api/v1/events/:eventId/occurrences/:date/plan',
    {
      schema: { tags: ['planner'], params: occParams, response: { 200: planOut } },
      onRequest: [requireAuth],
    },
    async (req) => {
      const { eventId, date } = req.params;
      const ev = await findEvent(app.prisma, eventId);
      await assertPlanner(app.prisma, ev.activityId);
      assertOccurrenceDate(ev, date);
      return buildPlan(
        app.prisma,
        ev.activityId,
        eventId,
        date,
        await readOccurrence(app.prisma, eventId, date),
      );
    },
  );

  /** All planner writes: lock the Activity row first, then get-or-create the occurrence, then check the version. */
  async function write<T>(
    eventId: string,
    date: string,
    expectedVersion: number,
    fn: (
      tx: Parameters<Parameters<typeof app.tx>[0]>[0],
      occ: Awaited<ReturnType<typeof getOrCreateOccurrence>>,
    ) => Promise<T>,
  ): Promise<T> {
    const ev = await findEvent(app.prisma, eventId);
    await assertPlanner(app.prisma, ev.activityId);
    return app.tx(async (tx) => {
      await withActivityLock(tx, ev.activityId);
      const occ = await getOrCreateOccurrence(tx, eventId, date);
      await assertVersion(tx, occ, expectedVersion, date);
      return fn(tx, occ);
    });
  }

  r.put(
    '/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId',
    {
      schema: {
        tags: ['planner'],
        params: occParams.extend({ memberId: z.uuid() }),
        body: z
          .object({
            teamId: z.number().int().positive().nullable(),
            slot: z.number().int().optional(),
            expectedVersion: version,
          })
          .strict()
          .refine((b) => b.teamId !== null || b.slot === undefined, { message: 'slot needs a teamId' }),
        response: { 200: z.object({ version: z.number() }) },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const { eventId, date, memberId } = req.params;
      const b = req.body;
      const res = await write(eventId, date, b.expectedVersion, (tx, occ) =>
        placeMember(tx, {
          occ,
          memberId,
          teamId: b.teamId,
          slot: b.slot,
          actor: { memberId: req.auth!.memberId },
          requestId: req.id,
        }),
      );
      return { version: res.version };
    },
  );

  r.post(
    '/api/v1/events/:eventId/occurrences/:date/plan/clear',
    {
      schema: {
        tags: ['planner'],
        params: occParams,
        body: z.object({ expectedVersion: version }).strict(),
        response: { 200: z.object({ version: z.number(), removed: z.number() }) },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      write(req.params.eventId, req.params.date, req.body.expectedVersion, (tx, occ) =>
        clearPlan(tx, occ, { memberId: req.auth!.memberId }, req.id),
      ),
  );

  r.post(
    '/api/v1/events/:eventId/occurrences/:date/plan/copy-from-previous',
    {
      schema: {
        tags: ['planner'],
        params: occParams,
        body: z.object({ expectedVersion: version, sourceDate: dateStr.optional() }).strict(),
        response: {
          200: z.object({
            copied: z.number(),
            skipped: z.array(
              z.object({
                memberId: z.string(),
                reason: z.enum(['MEMBER_INACTIVE', 'TEAM_REMOVED', 'SLOT_OUT_OF_RANGE']),
              }),
            ),
            version: z.number(),
            sourceDate: z.string(),
          }),
        },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      write(req.params.eventId, req.params.date, req.body.expectedVersion, (tx, occ) =>
        copyFromPrevious(tx, {
          occ,
          date: req.params.date,
          sourceDate: req.body.sourceDate,
          actor: { memberId: req.auth!.memberId },
          requestId: req.id,
        }),
      ),
  );
}
