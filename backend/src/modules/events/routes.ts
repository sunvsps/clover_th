import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../plugins/requireAdmin.js';

const eventOut = z.object({
  id: z.string(),
  activityId: z.string(),
  name: z.string(),
  isGuild: z.boolean(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
});

export default async function eventRoutes(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/api/v1/events',
      { schema: { tags: ['schedule'], response: { 200: z.array(eventOut) } }, onRequest: [requireAuth] },
      async () => {
        const rows = await app.prisma.scheduleEvent.findMany({
          orderBy: { sortOrder: 'asc' },
          include: { activity: true },
        });
        return rows.map((e) => ({
          id: e.id,
          activityId: e.activityId,
          name: e.activity.name,
          isGuild: e.activity.isGuild,
          dayOfWeek: e.dayOfWeek,
          startTime: e.startTime,
          endTime: e.endTime,
        }));
      },
    );
}
