import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { nameField } from '../../lib/text.js';
import type { Tx } from '../../lib/tx.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';

const jobOut = z.object({
  id: z.number(),
  label: z.string(),
  color: z.string(),
  sortOrder: z.number(),
  inUse: z.boolean(),
});
const jobsOut = z.array(jobOut);

const entry = z
  .object({
    id: z.number().int().positive().optional(),
    label: nameField(64),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb'),
    sortOrder: z.number().int().optional(),
  })
  .strict();

async function listJobs(tx: Pick<Tx, 'job'>) {
  const jobs = await tx.job.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { members: true } } },
  });
  return jobs.map((j) => ({
    id: j.id,
    label: j.label,
    color: j.color,
    sortOrder: j.sortOrder,
    inUse: j._count.members > 0,
  }));
}

export default async function jobRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/v1/jobs',
    { schema: { tags: ['jobs'], response: { 200: jobsOut } }, onRequest: [requireAuth] },
    () => listJobs(app.prisma),
  );

  // Atomic replace matching the frontend draft-then-Save flow: entries with id update, without id create,
  // missing ones delete (rejected while any member, active or not, uses the job).
  r.put(
    '/api/v1/admin/jobs',
    {
      schema: {
        tags: ['jobs'],
        body: z.object({ jobs: z.array(entry).max(100) }).strict(),
        response: { 200: jobsOut },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const wanted = req.body.jobs;
      // Case-insensitive (and NFC) uniqueness, like IGNs; the job_label_ci index is the final guard.
      const labels = wanted.map((j) => j.label.normalize('NFC').toLowerCase());
      if (new Set(labels).size !== labels.length)
        throw new AppError('DUPLICATE_JOB_LABEL', 409, 'Duplicate job label');
      const ids = wanted.flatMap((j) => (j.id !== undefined ? [j.id] : []));
      if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', 422, 'Duplicate job id');

      return app.tx(async (tx) => {
        const existing = await tx.job.findMany({ include: { _count: { select: { members: true } } } });
        const known = new Set(existing.map((j) => j.id));
        if (ids.some((id) => !known.has(id))) throw new AppError('NOT_FOUND', 404, 'Unknown job id');

        const keep = new Set(ids);
        const toDelete = existing.filter((j) => !keep.has(j.id));
        const inUse = toDelete.filter((j) => j._count.members > 0).map((j) => j.id);
        if (inUse.length)
          throw new AppError('JOB_IN_USE', 409, 'A job in use cannot be deleted', { jobIds: inUse });

        const byId = new Map(existing.map((j) => [j.id, j]));
        await tx.job.deleteMany({ where: { id: { in: toDelete.map((j) => j.id) } } });
        // Two-phase rename so swapping labels cannot trip the unique index mid-way.
        const renames = wanted.filter((j) => j.id !== undefined && byId.get(j.id)!.label !== j.label);
        for (const j of renames)
          await tx.job.update({ where: { id: j.id! }, data: { label: `~tmp~${j.id}~` } });
        const updated: number[] = [];
        for (const [i, j] of wanted.entries()) {
          if (j.id === undefined) continue;
          const old = byId.get(j.id)!;
          const sortOrder = j.sortOrder ?? i;
          if (old.label !== j.label || old.color !== j.color || old.sortOrder !== sortOrder) {
            await tx.job.update({ where: { id: j.id }, data: { label: j.label, color: j.color, sortOrder } });
            updated.push(j.id);
          }
        }
        const created: number[] = [];
        for (const [i, j] of wanted.entries()) {
          if (j.id !== undefined) continue;
          created.push(
            (await tx.job.create({ data: { label: j.label, color: j.color, sortOrder: j.sortOrder ?? i } }))
              .id,
          );
        }
        await record(tx, {
          actorType: 'MEMBER',
          actorId: req.auth!.memberId,
          action: 'jobs.replace',
          entityType: 'job',
          entityId: 'all',
          meta: { created, updated, deleted: toDelete.map((j) => j.id) },
          requestId: req.id,
        });
        return listJobs(tx);
      });
    },
  );
}
