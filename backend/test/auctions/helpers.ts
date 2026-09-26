import { createHash, randomBytes } from 'node:crypto';
import { CSRF } from '../helpers/app.js';
import type { World } from '../helpers/world.js';

export type H = Record<string, string>;
export type Cat = 'PET' | 'MATERIAL' | 'GEMBOX' | 'GEAR' | 'CARD' | 'RELIC';

/** Creates a member with a session directly in the DB (the OAuth callback is rate limited per IP, so 80 logins would trip it). */
export async function session(w: World, opts: { admin?: boolean; ign?: string } = {}) {
  const m = await w.member(opts.ign, opts.admin ? { isAdmin: true } : {});
  const token = randomBytes(32).toString('base64url');
  const id = createHash('sha256').update(token).digest('hex');
  await w.db.prisma.$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt")
    VALUES (${id}, ${m.id}::uuid, clock_timestamp() + interval '1 day')`;
  return { ...m, h: { cookie: `session=${token}`, ...CSRF } as H };
}

export const sessions = (w: World, n: number, prefix = 'Bidder') =>
  Promise.all(Array.from({ length: n }, (_, i) => session(w, { ign: `${prefix}${i}` })));

export const api = (w: World) => ({
  create: (h: H, body: object) =>
    w.app.inject({ method: 'POST', url: '/api/v1/admin/auctions/rounds', headers: h, payload: body }),
  patch: (h: H, id: number, body: object) =>
    w.app.inject({ method: 'PATCH', url: `/api/v1/admin/auctions/rounds/${id}`, headers: h, payload: body }),
  start: (h: H, id: number, body: object = {}) =>
    w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/auctions/rounds/${id}/start`,
      headers: h,
      payload: body,
    }),
  close: (h: H, id: number) =>
    w.app.inject({ method: 'POST', url: `/api/v1/admin/auctions/rounds/${id}/close`, headers: h }),
  cancel: (h: H, id: number) =>
    w.app.inject({ method: 'POST', url: `/api/v1/admin/auctions/rounds/${id}/cancel`, headers: h }),
  get: (h: H, id: number, extra: H = {}) =>
    w.app.inject({ url: `/api/v1/auctions/rounds/${id}`, headers: { ...h, ...extra } }),
  list: (h: H, q = '') => w.app.inject({ url: `/api/v1/auctions/rounds${q}`, headers: h }),
  claim: (h: H, round: number, item: number) =>
    w.app.inject({ method: 'POST', url: `/api/v1/auctions/rounds/${round}/items/${item}/claim`, headers: h }),
  release: (h: H, round: number, item: number) =>
    w.app.inject({
      method: 'DELETE',
      url: `/api/v1/auctions/rounds/${round}/items/${item}/claim`,
      headers: h,
    }),
  results: (h: H, id: number) => w.app.inject({ url: `/api/v1/auctions/rounds/${id}/results`, headers: h }),
  mine: (h: H, id: number) => w.app.inject({ url: `/api/v1/auctions/rounds/${id}/results/me`, headers: h }),
  leftover: (h: H, id: number) =>
    w.app.inject({ method: 'POST', url: `/api/v1/admin/auctions/rounds/${id}/leftover`, headers: h }),
});

export const items = (n: number, category: Cat = 'PET') =>
  Array.from({ length: n }, (_, i) => ({ name: `Item ${i + 1}`, category }));

/** Creates a round and starts it with no start delay. Returns the round id and its item ids. */
export async function openRound(
  w: World,
  admin: { h: H },
  o: { items?: object[]; itemCount?: number; winCap?: number; durationSec?: number } = {},
) {
  const A = api(w);
  const created = await A.create(admin.h, {
    type: 'LIVE_CLAIM',
    name: 'Round',
    winCap: o.winCap ?? 5,
    durationSec: o.durationSec ?? 300,
    startDelaySec: 0,
    items: o.items ?? items(o.itemCount ?? 3),
  });
  const id = created.json().id as number;
  const started = await A.start(admin.h, id);
  if (started.statusCode !== 200) throw new Error(`start failed: ${started.body}`);
  const ids = (
    await w.db.prisma.auctionItem.findMany({ where: { roundId: id }, orderBy: { id: 'asc' } })
  ).map((i) => i.id);
  return { id, itemIds: ids };
}

/** Test helper: move the window relative to the DB clock (the only clock the server trusts), e.g. ('-10 seconds', '-1 second'). */
export const setWindow = (w: World, id: number, opens: string, closes: string) =>
  w.db.prisma.$executeRawUnsafe(
    `UPDATE "AuctionRound" SET "opensAt" = clock_timestamp() + interval '${opens}', "closesAt" = clock_timestamp() + interval '${closes}' WHERE id = ${id}`,
  );

export const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

// ---------- type 2 helpers ----------
export const queueApi = (w: World) => ({
  join: (h: H, category: string) =>
    w.app.inject({ method: 'PUT', url: `/api/v1/auctions/queues/${category}/me`, headers: h }),
  leave: (h: H, category: string) =>
    w.app.inject({ method: 'DELETE', url: `/api/v1/auctions/queues/${category}/me`, headers: h }),
  queues: (h: H) => w.app.inject({ url: '/api/v1/auctions/queues', headers: h }),
  remove: (h: H, category: string, memberId: string) =>
    w.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/auctions/queues/${category}/${memberId}`,
      headers: h,
    }),
  replace: (h: H, category: string, memberIds: string[], expected?: string[]) =>
    w.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/auctions/queues/${category}`,
      headers: h,
      payload: expected ? { memberIds, expected } : { memberIds },
    }),
  history: (h: H, q = '') => w.app.inject({ url: `/api/v1/auctions/queues/history${q}`, headers: h }),
  setPrefs: (h: H, roundId: number, itemIds: number[]) =>
    w.app.inject({
      method: 'PUT',
      url: `/api/v1/auctions/rounds/${roundId}/preferences/me`,
      headers: h,
      payload: { itemIds },
    }),
  myPrefs: (h: H, roundId: number) =>
    w.app.inject({ url: `/api/v1/auctions/rounds/${roundId}/preferences/me`, headers: h }),
  adminPrefs: (h: H, roundId: number) =>
    w.app.inject({ url: `/api/v1/admin/auctions/rounds/${roundId}/preferences`, headers: h }),
});

/** Creates a QUEUE_RANKED round with the given items and starts it (no delay). */
export async function openQueueRound(
  w: World,
  admin: { h: H },
  items: { name: string; category?: Cat; disabled?: boolean }[],
  o: { durationSec?: number } = {},
) {
  const A = api(w);
  const created = await A.create(admin.h, {
    type: 'QUEUE_RANKED',
    name: 'Queue round',
    durationSec: o.durationSec ?? 300,
    startDelaySec: 0,
    items,
  });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  const id = created.json().id as number;
  const started = await A.start(admin.h, id);
  if (started.statusCode !== 200) throw new Error(`start failed: ${started.body}`);
  const rows = await w.db.prisma.auctionItem.findMany({ where: { roundId: id }, orderBy: { id: 'asc' } });
  return { id, itemIds: rows.map((i) => i.id) };
}

/** Member ids of a queue, front to back, straight from the DB. */
export async function queueOrder(w: World, category: Cat) {
  return (await w.db.prisma.queueEntry.findMany({ where: { category }, orderBy: { id: 'asc' } })).map(
    (q) => q.memberId,
  );
}

/** Members join the queue one after another (so the order is deterministic). */
export async function joinInOrder(w: World, members: { h: H }[], category: Cat) {
  const Q = queueApi(w);
  for (const m of members) {
    const r = await Q.join(m.h, category);
    if (r.statusCode !== 200) throw new Error(`join failed: ${r.body}`);
  }
}
