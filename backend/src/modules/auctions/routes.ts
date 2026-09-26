import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { nameField, safeString } from '../../lib/text.js';
import { requireAdmin, requireAuth } from '../../plugins/requireAdmin.js';
import { claimItem, releaseItem } from './liveClaim.js';
import {
  eligibleCategories,
  readAllPreferences,
  readMyPreferences,
  submitPreferences,
} from './preferences.js';
import {
  joinQueue,
  leaveQueue,
  parseCategory,
  readQueueHistory,
  readQueues,
  removeFromQueue,
  replaceQueue,
} from './queue.js';
import {
  cancelRound,
  closeRound,
  createLeftoverDraft,
  createRound,
  dbNow,
  expiredOpenRounds,
  finalizeRound,
  myWinCount,
  readItems,
  readRound,
  readRoundOrThrow,
  roundFingerprint,
  roundOut,
  startRound,
  updateDraft,
  type RoundRow,
} from './rounds.js';

const category = z.enum(['PET', 'MATERIAL', 'GEMBOX', 'GEAR', 'CARD', 'RELIC']);
const imageUrl = safeString(2000).refine(
  (u) => /^https:\/\//i.test(u) && URL.canParse(u) && !new URL(u).username && !new URL(u).password,
  { message: 'must be an https URL without credentials' },
);
const itemIn = z
  .object({
    name: nameField(100),
    // Unset/null = untagged (live-claim rounds only; a queue round needs Gear/Card/Relic on every item).
    category: category.nullable().optional(),
    rarity: nameField(32).nullable().optional(),
    imageUrl: imageUrl.nullable().optional(),
    // keeps its slot on the board but can't be claimed or ranked
    disabled: z.boolean().optional(),
  })
  .strict();

const roundBase = z.object({
  id: z.number(),
  type: z.enum(['LIVE_CLAIM', 'QUEUE_RANKED']),
  name: z.string(),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']),
  durationSec: z.number(),
  winCap: z.number().nullable(),
  startDelaySec: z.number(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
});
const winner = z
  .object({ memberId: z.string(), wonAt: z.string(), queuePos: z.number().nullable() })
  .nullable();
const itemOut = z.object({
  id: z.number(),
  name: z.string(),
  category: category.nullable(),
  rarity: z.string().nullable(),
  imageUrl: z.string().nullable(),
  disabled: z.boolean(),
  winner,
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemParams = idParam.extend({ itemId: z.coerce.number().int().positive() });

export default async function auctionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const claimLimit = {
    rateLimit: {
      max: app.env.CLAIM_RATE_MAX,
      timeWindow: '1 second',
      keyGenerator: (req: { auth?: { memberId: string } | null; ip: string }) => req.auth?.memberId ?? req.ip,
    },
  };

  /** Lazy finalize: a window that ended but was not swept yet is closed before we answer. */
  async function lazyFinalize(id?: number) {
    // Best effort only (the sweeper owns finalization): a failing allocation must never turn every member's poll into a
    // 500. finalizeRound is one transaction, so a failure leaves no partial state and the round stays OPEN for a retry.
    try {
      const ids = id
        ? (await expiredOpenRounds(app.prisma)).filter((x) => x === id)
        : await expiredOpenRounds(app.prisma);
      for (const x of ids) {
        try {
          await app.tx((t) => finalizeRound(t, x));
        } catch (err) {
          app.log.error({ err, roundId: x }, 'lazy finalize failed; serving the read anyway');
        }
      }
    } catch (err) {
      app.log.error({ err }, 'lazy finalize lookup failed; serving the read anyway');
    }
  }

  const visible = (round: RoundRow | null, admin: boolean): RoundRow => {
    if (!round || (!admin && round.status === 'DRAFT'))
      throw new AppError('NOT_FOUND', 404, 'Round not found');
    return round;
  };
  const stamp = async (reply: FastifyReply) => {
    const now = await dbNow(app.prisma);
    reply.header('x-server-time', now.toISOString());
    return now;
  };

  // ---------- admin ----------
  const createBody = z
    .object({
      type: z.enum(['LIVE_CLAIM', 'QUEUE_RANKED']),
      name: nameField(100),
      durationSec: z.number().int().min(5).max(86400).default(300),
      /** live claim only (default 5); a queue round allocates one item per category, so it has no cap */
      winCap: z.number().int().min(1).max(50).optional(),
      startDelaySec: z.number().int().min(0).max(60).default(3),
      items: z.array(itemIn).max(500).default([]),
    })
    .strict()
    .refine((b) => b.type === 'LIVE_CLAIM' || b.winCap === undefined, {
      message: 'winCap applies to live-claim rounds only',
      path: ['winCap'],
    });

  r.post(
    '/api/v1/admin/auctions/rounds',
    {
      schema: { tags: ['auctions'], body: createBody, response: { 201: roundBase } },
      onRequest: [requireAdmin],
    },
    async (req, reply) => {
      const b = req.body;
      const round = await app.tx((tx) =>
        createRound(tx, {
          ...b,
          winCap: b.type === 'LIVE_CLAIM' ? (b.winCap ?? 5) : null,
          actorId: req.auth!.memberId,
          requestId: req.id,
        }),
      );
      return reply.status(201).send(roundOut(round));
    },
  );

  r.patch(
    '/api/v1/admin/auctions/rounds/:id',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        body: z
          .object({
            name: nameField(100).optional(),
            durationSec: z.number().int().min(5).max(86400).optional(),
            winCap: z.number().int().min(1).max(50).optional(),
            startDelaySec: z.number().int().min(0).max(60).optional(),
            items: z.array(itemIn).max(500).optional(),
          })
          .strict()
          .refine((b) => Object.keys(b).length > 0, { message: 'provide at least one field' }),
        response: { 200: roundBase },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      roundOut(await app.tx((tx) => updateDraft(tx, req.params.id, req.body, req.auth!.memberId, req.id))),
  );

  r.post(
    '/api/v1/admin/auctions/rounds/:id/start',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        body: z
          .object({
            startDelaySec: z.number().int().min(0).max(60).optional(),
            durationSec: z.number().int().min(5).max(86400).optional(),
          })
          .strict()
          .default({}),
        response: { 200: roundBase },
      },
      onRequest: [requireAdmin],
    },
    async (req) =>
      roundOut(await app.tx((tx) => startRound(tx, req.params.id, req.body, req.auth!.memberId, req.id))),
  );

  r.post(
    '/api/v1/admin/auctions/rounds/:id/close',
    {
      schema: { tags: ['auctions'], params: idParam, response: { 200: roundBase } },
      onRequest: [requireAdmin],
    },
    async (req) => roundOut(await app.tx((tx) => closeRound(tx, req.params.id, req.auth!.memberId, req.id))),
  );

  r.post(
    '/api/v1/admin/auctions/rounds/:id/cancel',
    {
      schema: { tags: ['auctions'], params: idParam, response: { 200: roundBase } },
      onRequest: [requireAdmin],
    },
    async (req) => roundOut(await app.tx((tx) => cancelRound(tx, req.params.id, req.auth!.memberId, req.id))),
  );

  r.post(
    '/api/v1/admin/auctions/rounds/:id/leftover',
    {
      schema: {
        tags: ['auctions'],
        summary: 'Leftover draft of a closed live-claim round (created once, claimed items disabled)',
        params: idParam,
        response: { 200: roundBase, 201: roundBase },
      },
      onRequest: [requireAdmin],
    },
    async (req, reply) => {
      const { round, created } = await app.tx((tx) =>
        createLeftoverDraft(tx, req.params.id, req.auth!.memberId, req.id),
      );
      return reply.status(created ? 201 : 200).send(roundOut(round));
    },
  );

  // ---------- members ----------
  r.get(
    '/api/v1/auctions/rounds',
    {
      schema: {
        tags: ['auctions'],
        querystring: z.object({ status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']).optional() }),
        response: {
          200: z.object({
            serverTime: z.string(),
            rounds: z.array(
              roundBase.extend({
                itemCount: z.number(),
                /** items that are not disabled (what can be claimed or allocated) */
                activeItemCount: z.number(),
                /** items that have a winner (claimed live, or allocated when a queue round closed) */
                claimedCount: z.number(),
                /** set on a leftover round: the round it was made from */
                sourceRoundId: z.number().nullable(),
                /** set once a leftover round was made from this one */
                leftoverRoundId: z.number().nullable(),
              }),
            ),
          }),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      await lazyFinalize();
      const admin = req.auth!.isAdmin;
      const rows = await app.prisma.auctionRound.findMany({
        where: {
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(admin ? {} : { status: req.query.status ? req.query.status : { in: ['OPEN', 'CLOSED'] } }),
        },
        orderBy: { id: 'desc' },
        take: 100,
        include: { _count: { select: { items: true } }, leftoverDraft: { select: { id: true } } },
      });
      const ids = rows.map((x) => x.id);
      const counts = ids.length
        ? await app.prisma.$queryRaw<{ roundId: number; active: number; claimed: number }[]>`
            SELECT "roundId", (count(*) FILTER (WHERE NOT disabled))::int AS active,
                   (count(*) FILTER (WHERE "winnerId" IS NOT NULL))::int AS claimed
            FROM "AuctionItem" WHERE "roundId" = ANY(${ids}::int[]) GROUP BY "roundId"`
        : [];
      const countOf = new Map(counts.map((c) => [c.roundId, c]));
      return {
        serverTime: (await dbNow(app.prisma)).toISOString(),
        rounds: rows
          .filter((x) => admin || x.status === 'OPEN' || x.status === 'CLOSED')
          .map((x) => ({
            ...roundOut({ ...x, type: x.type, status: x.status } as unknown as RoundRow),
            itemCount: x._count.items,
            activeItemCount: countOf.get(x.id)?.active ?? 0,
            claimedCount: countOf.get(x.id)?.claimed ?? 0,
            sourceRoundId: x.sourceRoundId,
            leftoverRoundId: x.leftoverDraft?.id ?? null,
          })),
      };
    },
  );

  // Polling endpoint: no server cache; cheap ETag (If-None-Match -> 304); server time in the body and in X-Server-Time.
  r.get(
    '/api/v1/auctions/rounds/:id',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        response: {
          200: roundBase.extend({
            serverTime: z.string(),
            items: z.array(itemOut),
            myWinCount: z.number(),
            /** type 2: the categories this member is eligible for in this round (queue entry at or before the cutoff) */
            eligibleCategories: z.array(z.string()),
          }),
        },
      },
      onRequest: [requireAuth],
    },
    async (req, reply) => {
      const { id } = req.params;
      const me = req.auth!;
      await lazyFinalize(id);
      const round = visible(await readRound(app.prisma, id), me.isAdmin);
      const etag = await roundFingerprint(app.prisma, id, me.memberId);
      if (etag) reply.header('etag', etag);
      const now = await stamp(reply);
      if (etag && req.headers['if-none-match'] === etag)
        return (reply as unknown as FastifyReply).status(304).send();
      reply.header('cache-control', 'no-cache');
      return reply.send({
        ...roundOut(round),
        serverTime: now.toISOString(),
        items: await readItems(app.prisma, id),
        myWinCount: await myWinCount(app.prisma, id, me.memberId),
        eligibleCategories:
          round.type === 'QUEUE_RANKED' ? await eligibleCategories(app.prisma, id, me.memberId) : [],
      });
    },
  );

  r.post(
    '/api/v1/auctions/rounds/:id/items/:itemId/claim',
    {
      schema: {
        tags: ['auctions'],
        params: itemParams,
        response: { 200: z.object({ item: itemOut, myWinCount: z.number() }) },
      },
      onRequest: [requireAuth],
      config: claimLimit,
    },
    async (req) =>
      app.tx((tx) =>
        claimItem(tx, {
          roundId: req.params.id,
          itemId: req.params.itemId,
          memberId: req.auth!.memberId,
          requestId: req.id,
        }),
      ),
  );

  r.delete(
    '/api/v1/auctions/rounds/:id/items/:itemId/claim',
    {
      schema: {
        tags: ['auctions'],
        params: itemParams,
        response: { 200: z.object({ item: itemOut, myWinCount: z.number() }) },
      },
      onRequest: [requireAuth],
      config: claimLimit,
    },
    async (req) =>
      app.tx((tx) =>
        releaseItem(tx, {
          roundId: req.params.id,
          itemId: req.params.itemId,
          memberId: req.auth!.memberId,
          requestId: req.id,
        }),
      ),
  );

  r.get(
    '/api/v1/auctions/rounds/:id/results',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        response: {
          200: z.object({
            roundId: z.number(),
            status: z.literal('CLOSED'),
            closedAt: z.string().nullable(),
            serverTime: z.string(),
            items: z.array(itemOut),
            leftoverRoundId: z.number().nullable(),
          }),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const { id } = req.params;
      await lazyFinalize(id);
      const round = visible(await readRound(app.prisma, id), req.auth!.isAdmin);
      if (round.status !== 'CLOSED') {
        throw new AppError('ROUND_NOT_CLOSED', 409, 'Results are available after the round closed', {
          status: round.status,
        });
      }
      const [row] = await app.prisma.$queryRaw<{ id: number | null }[]>`
        SELECT id FROM "AuctionRound" WHERE "sourceRoundId" = ${id}`;
      return {
        roundId: id,
        status: 'CLOSED' as const,
        closedAt: (await readRoundOrThrow(app.prisma, id)).closedAt?.toISOString() ?? null,
        serverTime: (await dbNow(app.prisma)).toISOString(),
        items: await readItems(app.prisma, id),
        leftoverRoundId: row?.id ?? null,
      };
    },
  );

  // Own wins only (dropped connections): available during and after the round.
  r.get(
    '/api/v1/auctions/rounds/:id/results/me',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        response: {
          200: z.object({
            roundId: z.number(),
            status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']),
            serverTime: z.string(),
            items: z.array(itemOut),
            myWinCount: z.number(),
          }),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const { id } = req.params;
      const me = req.auth!;
      await lazyFinalize(id);
      const round = visible(await readRound(app.prisma, id), me.isAdmin);
      const items = await readItems(app.prisma, id, me.memberId);
      return {
        roundId: id,
        status: round.status,
        serverTime: (await dbNow(app.prisma)).toISOString(),
        items,
        myWinCount: items.length,
      };
    },
  );

  // ---------- type 2: queues, preferences ----------
  const queueOut = z.object({ category: z.string(), length: z.number(), myRank: z.number().nullable() });
  const categoryParam = z.object({ category: safeString(20) });

  r.get(
    '/api/v1/auctions/queues',
    {
      schema: {
        tags: ['auctions'],
        response: {
          200: z.array(
            queueOut.extend({ entries: z.array(z.object({ rank: z.number(), memberId: z.string() })) }),
          ),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => readQueues(app.prisma, req.auth!.memberId),
  );

  r.put(
    '/api/v1/auctions/queues/:category/me',
    {
      schema: { tags: ['auctions'], params: categoryParam, response: { 200: queueOut } },
      onRequest: [requireAuth],
    },
    async (req) => {
      const category = parseCategory(req.params.category);
      return app.tx((tx) => joinQueue(tx, category, req.auth!.memberId, req.id));
    },
  );

  r.delete(
    '/api/v1/auctions/queues/:category/me',
    {
      schema: { tags: ['auctions'], params: categoryParam, response: { 200: queueOut } },
      onRequest: [requireAuth],
    },
    async (req) => {
      const category = parseCategory(req.params.category);
      return app.tx((tx) => leaveQueue(tx, category, req.auth!.memberId, req.id));
    },
  );

  r.delete(
    '/api/v1/admin/auctions/queues/:category/:memberId',
    {
      schema: {
        tags: ['auctions'],
        params: categoryParam.extend({ memberId: z.uuid() }),
        response: { 200: queueOut },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const category = parseCategory(req.params.category);
      return app.tx((tx) => removeFromQueue(tx, category, req.params.memberId, req.auth!.memberId, req.id));
    },
  );

  r.put(
    '/api/v1/admin/auctions/queues/:category',
    {
      schema: {
        tags: ['auctions'],
        summary: 'Admin: rewrite one queue in the given order (add, remove, reorder); refused while a queue round of it is open',
        params: categoryParam,
        body: z
          .object({
            /** the whole queue, first = rank 1 */
            memberIds: z.array(z.uuid()).max(1000),
            /** the order the admin loaded; a queue that changed since is not overwritten (QUEUE_CHANGED) */
            expected: z.array(z.uuid()).max(1000).optional(),
          })
          .strict(),
        response: {
          200: z.object({
            category: z.string(),
            length: z.number(),
            entries: z.array(z.object({ rank: z.number(), memberId: z.string() })),
          }),
        },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      const category = parseCategory(req.params.category);
      return app.tx((tx) =>
        replaceQueue(tx, category, req.body.memberIds, req.body.expected, req.auth!.memberId, req.id),
      );
    },
  );

  r.get(
    '/api/v1/auctions/queues/history',
    {
      schema: {
        tags: ['auctions'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }),
        response: {
          200: z.array(
            z.object({
              roundId: z.number(),
              roundName: z.string(),
              itemId: z.number(),
              itemName: z.string(),
              category: z.enum(['GEAR', 'CARD', 'RELIC']),
              memberId: z.string(),
              queuePos: z.number().nullable(),
              wonAt: z.string(),
            }),
          ),
        },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      await lazyFinalize();
      return readQueueHistory(app.prisma, req.query.limit);
    },
  );

  const prefsOut = z.object({ roundId: z.number(), itemIds: z.array(z.number()) });
  r.put(
    '/api/v1/auctions/rounds/:id/preferences/me',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        body: z.object({ itemIds: z.array(z.number().int().positive()).max(500) }).strict(),
        response: { 200: prefsOut },
      },
      onRequest: [requireAuth],
    },
    async (req) => {
      const res = await app.tx((tx) =>
        submitPreferences(tx, {
          roundId: req.params.id,
          memberId: req.auth!.memberId,
          itemIds: req.body.itemIds,
          requestId: req.id,
        }),
      );
      return { roundId: req.params.id, ...res };
    },
  );

  // Own list only (members never see other members' lists; admins use the admin route).
  r.get(
    '/api/v1/auctions/rounds/:id/preferences/me',
    {
      schema: { tags: ['auctions'], params: idParam, response: { 200: prefsOut } },
      onRequest: [requireAuth],
    },
    async (req) => {
      const me = req.auth!;
      visible(await readRound(app.prisma, req.params.id), me.isAdmin);
      return {
        roundId: req.params.id,
        itemIds: await readMyPreferences(app.prisma, req.params.id, me.memberId),
      };
    },
  );

  r.get(
    '/api/v1/admin/auctions/rounds/:id/preferences',
    {
      schema: {
        tags: ['auctions'],
        params: idParam,
        response: {
          200: z.object({
            roundId: z.number(),
            lists: z.array(z.object({ memberId: z.string(), itemIds: z.array(z.number()) })),
          }),
        },
      },
      onRequest: [requireAdmin],
    },
    async (req) => {
      await readRoundOrThrow(app.prisma, req.params.id);
      return { roundId: req.params.id, lists: await readAllPreferences(app.prisma, req.params.id) };
    },
  );
}
