import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { errors } from '../../lib/errors.js';
import { nameField } from '../../lib/text.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';
import { deactivateMember } from './deactivate.js';
import { diff, resolveJob } from './upsert.js';

const flag = z
  .enum(['1', '0', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const rosterItem = z.object({
  id: z.string(),
  ign: z.string(),
  nickname: z.string().nullable(),
  jobId: z.number(),
});
const adminItem = rosterItem.extend({
  discordId: z.string(),
  isActive: z.boolean(),
  isAdmin: z.boolean(),
  isIncomplete: z.boolean(),
});
const idParam = z.object({ id: z.uuid() });

type Row = {
  id: string;
  ign: string;
  nickname: string | null;
  jobId: number;
  discordId: string;
  isActive: boolean;
  isAdmin: boolean;
  source: string;
};
const toAdmin = (m: Row) => ({
  id: m.id,
  ign: m.ign,
  nickname: m.nickname,
  jobId: m.jobId,
  discordId: m.discordId,
  isActive: m.isActive,
  isAdmin: m.isAdmin,
  isIncomplete: m.nickname === null || m.source === 'MANUAL',
});

export default async function memberRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Roster for everyone signed in: no Discord id, no admin flag.
  r.get(
    '/api/v1/members',
    { schema: { tags: ['members'], response: { 200: z.array(rosterItem) } }, onRequest: [requireAuth] },
    async () => {
      const rows = await app.prisma.member.findMany({
        where: { isActive: true },
        orderBy: [{ ign: 'asc' }, { id: 'asc' }],
        select: { id: true, ign: true, nickname: true, jobId: true },
      });
      return rows;
    },
  );

  r.get(
    '/api/v1/admin/members',
    {
      schema: {
        tags: ['members'],
        querystring: z.object({ incomplete: flag, includeInactive: flag }),
        response: { 200: z.array(adminItem) },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const where: Prisma.MemberWhereInput = {
        ...(req.query.includeInactive ? {} : { isActive: true }),
        ...(req.query.incomplete ? { OR: [{ nickname: null }, { source: 'MANUAL' }] } : {}),
      };
      return (await app.prisma.member.findMany({ where, orderBy: [{ ign: 'asc' }, { id: 'asc' }] })).map(
        toAdmin,
      );
    },
  );

  // Duplicate IGN surfaces as a unique violation and is mapped to DUPLICATE_IGN by the error handler.
  r.patch(
    '/api/v1/admin/members/:id',
    {
      schema: {
        tags: ['members'],
        params: idParam,
        body: z
          .object({
            ign: nameField(64).optional(),
            nickname: nameField(64).nullable().optional(),
            jobId: z.number().int().positive().optional(),
          })
          .strict()
          .refine((b) => Object.keys(b).length > 0, { message: 'provide at least one field' }),
        response: { 200: adminItem },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      app.tx(async (tx) => {
        const before = await tx.member.findUnique({ where: { id: req.params.id } });
        if (!before) throw errors.memberNotFound();
        const { ign, nickname, jobId } = req.body;
        if (jobId !== undefined) await resolveJob(tx, { jobId });
        const after = await tx.member.update({
          where: { id: before.id },
          data: {
            ...(ign !== undefined ? { ign } : {}),
            ...(nickname !== undefined ? { nickname } : {}),
            ...(jobId !== undefined ? { jobId } : {}),
          },
        });
        const changes = diff(before, after, ['ign', 'nickname', 'jobId']);
        if (Object.keys(changes).length > 0) {
          await record(tx, {
            actorType: 'MEMBER',
            actorId: req.auth!.memberId,
            action: 'member.update',
            entityType: 'member',
            entityId: before.id,
            meta: { via: 'admin', changes } as never,
            requestId: req.id,
          });
        }
        return toAdmin(after);
      }),
  );

  r.post(
    '/api/v1/admin/members/:id/deactivate',
    {
      schema: { tags: ['members'], params: idParam, response: { 200: adminItem } },
      onRequest: [requireAdmin],
    },
    async (req) => {
      // An admin can never deactivate themselves (the bot is a separate actor and is not restricted).
      if (req.params.id === req.auth!.memberId) throw errors.cannotDeactivateSelf();
      return app.tx(async (tx) => {
        if (!(await tx.member.findUnique({ where: { id: req.params.id }, select: { id: true } })))
          throw errors.memberNotFound();
        await deactivateMember(
          tx,
          req.params.id,
          { type: 'MEMBER', id: req.auth!.memberId },
          req.id,
          app.env.NOTIFICATIONS_PROVIDER,
        );
        return toAdmin(await tx.member.findUniqueOrThrow({ where: { id: req.params.id } }));
      });
    },
  );

  // Reactivation re-checks IGN uniqueness (the unique index fires; mapped to DUPLICATE_IGN).
  r.post(
    '/api/v1/admin/members/:id/reactivate',
    {
      schema: { tags: ['members'], params: idParam, response: { 200: adminItem } },
      onRequest: [requireAdmin],
    },
    async (req) =>
      app.tx(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "Member" SET "isActive" = true, "deactivatedAt" = NULL, "updatedAt" = clock_timestamp()
          WHERE id = ${req.params.id}::uuid AND NOT "isActive" RETURNING id`;
        if (rows.length > 0) {
          await record(tx, {
            actorType: 'MEMBER',
            actorId: req.auth!.memberId,
            action: 'member.reactivate',
            entityType: 'member',
            entityId: req.params.id,
            requestId: req.id,
          });
        }
        const m = await tx.member.findUnique({ where: { id: req.params.id } });
        if (!m) throw errors.memberNotFound();
        return toAdmin(m);
      }),
  );
}
