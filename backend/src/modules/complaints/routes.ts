import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { record } from '../../lib/audit.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';

// Like lib/text.ts's `isCleanText`, but newline and carriage return are allowed (this is the only
// free-text textarea field in the app; every other text input in the codebase is single-line).
// eslint-disable-next-line no-control-regex
const MULTILINE_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const multilineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !MULTILINE_CONTROL.test(s) && s.isWellFormed(), {
      message: 'contains control characters or invalid unicode',
    });

const complaintOut = z.object({
  id: z.number(),
  memberId: z.string(),
  title: z.string(),
  description: z.string(),
  createdAt: z.string(),
});

const adminComplaintOut = complaintOut.extend({ memberIgn: z.string() });

export default async function complaintRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/v1/complaints',
    {
      schema: {
        tags: ['complaints'],
        body: z.object({ title: multilineText(200), description: multilineText(4000) }).strict(),
        response: { 201: complaintOut },
      },
      onRequest: [requireAuth],
    },
    async (req, reply) => {
      const auth = req.auth!;
      const complaint = await app.prisma.complaint.create({
        data: { memberId: auth.memberId, title: req.body.title, description: req.body.description },
      });
      await record(app.prisma, {
        actorType: 'MEMBER',
        actorId: auth.memberId,
        action: 'complaint.create',
        entityType: 'Complaint',
        entityId: String(complaint.id),
        requestId: req.id,
      });
      reply.code(201);
      return {
        id: complaint.id,
        memberId: complaint.memberId,
        title: complaint.title,
        description: complaint.description,
        createdAt: complaint.createdAt.toISOString(),
      };
    },
  );

  // Admin only: complaints are visible to admins, not to the members who filed them.
  r.get(
    '/api/v1/admin/complaints',
    {
      schema: {
        tags: ['complaints'],
        response: { 200: z.object({ items: z.array(adminComplaintOut) }) },
      },
      onRequest: [requireAdmin],
    },
    async () => {
      const rows = await app.prisma.complaint.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { member: { select: { ign: true } } },
      });
      return {
        items: rows.map((c) => ({
          id: c.id,
          memberId: c.memberId,
          memberIgn: c.member.ign,
          title: c.title,
          description: c.description,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },
  );
}
