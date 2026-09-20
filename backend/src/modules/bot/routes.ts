import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IGN_INDEX, errors } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pgErrors.js';
import { requireBotKey } from '../../plugins/botAuth.js';
import { deactivateMember } from '../members/deactivate.js';
import { resolveJob, upsertBotMember } from '../members/upsert.js';

const snowflake = z.string().regex(/^\d{5,25}$/, 'must be a Discord id (digits)');
const name = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(1).max(max));

const putBody = z
  .object({
    ign: name(64),
    job: z.string().min(1).max(64).optional(),
    jobId: z.number().int().positive().optional(),
    nickname: name(64).nullable().optional(),
  })
  .strict()
  .refine((b) => (b.job === undefined) !== (b.jobId === undefined), {
    message: 'provide exactly one of job (label) or jobId',
  });

const memberOut = z.object({
  memberId: z.string(),
  discordId: z.string(),
  ign: z.string(),
  nickname: z.string().nullable(),
  job: z.object({ id: z.number(), label: z.string(), color: z.string() }),
  isActive: z.boolean(),
  isIncomplete: z.boolean(),
});

const botLimit = { rateLimit: { max: 300, timeWindow: '1 minute' } };

export default async function botRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Never log bodies or the X-Bot-Key header on these routes (logger serializers drop both).
  r.put(
    '/api/v1/bot/members/:discordId',
    {
      schema: {
        tags: ['bot'],
        params: z.object({ discordId: snowflake }),
        body: putBody,
        response: { 200: memberOut, 201: memberOut },
      },
      onRequest: [requireBotKey],
      config: botLimit,
    },
    async (req, reply) => {
      const { discordId } = req.params;
      const { ign, job, jobId, nickname } = req.body;

      const { member, created } = await app
        .tx(async (tx) => {
          const jobRow = await resolveJob(tx, { job, jobId });
          return upsertBotMember(
            tx,
            { discordId, ign, jobId: jobRow.id, nickname },
            { actorType: 'BOT', requestId: req.id, via: 'bot' },
          );
        })
        .catch((err) => {
          throw isUniqueViolation(err, ...IGN_INDEX) ? errors.duplicateIgn() : err;
        });

      return reply.status(created ? 201 : 200).send({
        memberId: member.id,
        discordId: member.discordId,
        ign: member.ign,
        nickname: member.nickname,
        job: { id: member.job.id, label: member.job.label, color: member.job.color },
        isActive: member.isActive,
        isIncomplete: member.nickname === null || member.source === 'MANUAL',
      });
    },
  );

  r.post(
    '/api/v1/bot/members/:discordId/deactivate',
    {
      schema: {
        tags: ['bot'],
        params: z.object({ discordId: snowflake }),
        response: { 200: z.object({ memberId: z.string(), isActive: z.literal(false) }) },
      },
      onRequest: [requireBotKey],
      config: botLimit,
    },
    async (req) => {
      const member = await app.prisma.member.findUnique({
        where: { discordId: req.params.discordId },
        select: { id: true },
      });
      if (!member) throw errors.memberNotFound();
      await app.tx((tx) => deactivateMember(tx, member.id, { type: 'BOT' }, req.id));
      return { memberId: member.id, isActive: false as const };
    },
  );
}
