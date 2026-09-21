import { conditionalGet, del, get, put, post } from "./client";
import type { paths } from "./schema";

type Ok<P extends keyof paths, M extends "get" | "put" | "post" | "delete"> = paths[P] extends Record<M, infer Op>
  ? Op extends { responses: { 200: { content: { "application/json": infer B } } } }
    ? B
    : never
  : never;

type WireRound = Ok<"/api/v1/auctions/rounds/{id}", "get">;
type WireRoundList = Ok<"/api/v1/auctions/rounds", "get">;
type WireItem = WireRound["items"][number];
type WireResults = Ok<"/api/v1/auctions/rounds/{id}/results", "get">;
type WireQueues = Ok<"/api/v1/auctions/queues", "get">;

/** UI names for the wire enums (the mapping lives here only). */
export type RoundType = "liveClaim" | "queueRanked";
export type RoundStatus = "draft" | "open" | "closed" | "cancelled";
export type Category = "pet" | "material" | "gembox" | "gear" | "card" | "relic";
export const CATEGORIES: Category[] = ["pet", "material", "gembox", "gear", "card", "relic"];
/** Queues exist for these categories only. */
export const QUEUE_CATEGORIES: Category[] = ["gear", "card", "relic"];

const typeFromWire = { LIVE_CLAIM: "liveClaim", QUEUE_RANKED: "queueRanked" } as const;
const statusFromWire = { DRAFT: "draft", OPEN: "open", CLOSED: "closed", CANCELLED: "cancelled" } as const;
const categoryFromWire = (c: string): Category => c.toLowerCase() as Category;
const categoryToWire = (c: Category) => c.toUpperCase();

export type AuctionItem = {
  id: number;
  name: string;
  category: Category;
  rarity: string | null;
  imageUrl: string | null;
  /** who holds it (claimed, or allocated after a queue round); `queuePos` only for queue rounds */
  winner: { memberId: string; wonAt: string; queuePos: number | null } | null;
};
export type RoundSummary = {
  id: number;
  type: RoundType;
  name: string;
  status: RoundStatus;
  durationSec: number;
  winCap: number | null;
  startDelaySec: number;
  opensAt: string | null;
  closesAt: string | null;
};
export type RoundListEntry = RoundSummary & { itemCount: number };
export type Round = RoundSummary & {
  items: AuctionItem[];
  myWinCount: number;
  /** queue rounds: the categories this member may rank */
  eligibleCategories: Category[];
};

const itemFromWire = (i: WireItem): AuctionItem => ({
  id: i.id,
  name: i.name,
  category: categoryFromWire(i.category),
  rarity: i.rarity,
  imageUrl: i.imageUrl,
  winner: i.winner,
});
const summaryFromWire = (r: WireRound | WireRoundList["rounds"][number]): RoundSummary => ({
  id: r.id,
  type: typeFromWire[r.type],
  name: r.name,
  status: statusFromWire[r.status],
  durationSec: r.durationSec,
  winCap: r.winCap,
  startDelaySec: r.startDelaySec,
  opensAt: r.opensAt,
  closesAt: r.closesAt,
});
const roundFromWire = (r: WireRound): Round => ({
  ...summaryFromWire(r),
  items: r.items.map(itemFromWire),
  myWinCount: r.myWinCount,
  eligibleCategories: r.eligibleCategories.map(categoryFromWire),
});

export async function listRounds(signal?: AbortSignal): Promise<RoundListEntry[]> {
  const body = await get<WireRoundList>("/api/v1/auctions/rounds", { signal });
  return body.rounds.map((r) => ({ ...summaryFromWire(r), itemCount: r.itemCount }));
}

/** One poll of a round: `null` = 304, nothing changed since `etag`. */
export async function getRound(id: number, etag: string | null, signal?: AbortSignal): Promise<{ round: Round; etag: string | null } | null> {
  const res = await conditionalGet<WireRound>(`/api/v1/auctions/rounds/${id}`, etag, signal);
  return res.notModified ? null : { round: roundFromWire(res.data), etag: res.etag };
}

export type ClaimResult = { item: AuctionItem; myWinCount: number };
type WireClaim = Ok<"/api/v1/auctions/rounds/{id}/items/{itemId}/claim", "post">;
const claimFromWire = (r: WireClaim): ClaimResult => ({ item: itemFromWire(r.item), myWinCount: r.myWinCount });
export const claimItem = async (roundId: number, itemId: number) => claimFromWire(await post<WireClaim>(`/api/v1/auctions/rounds/${roundId}/items/${itemId}/claim`));
export const releaseItem = async (roundId: number, itemId: number) => claimFromWire(await del<WireClaim>(`/api/v1/auctions/rounds/${roundId}/items/${itemId}/claim`));

export type RoundResults = { closedAt: string | null; items: AuctionItem[]; leftoverRoundId: number | null };
export async function getResults(id: number): Promise<RoundResults> {
  const r = await get<WireResults>(`/api/v1/auctions/rounds/${id}/results`);
  return { closedAt: r.closedAt, items: r.items.map(itemFromWire), leftoverRoundId: r.leftoverRoundId };
}

export type Queue = { category: Category; length: number; myRank: number | null; entries: { rank: number; memberId: string }[] };
export async function getQueues(): Promise<Queue[]> {
  const rows = await get<WireQueues>("/api/v1/auctions/queues");
  return rows.map((q) => ({ category: categoryFromWire(q.category), length: q.length, myRank: q.myRank, entries: q.entries }));
}
export const joinQueue = (category: Category) => put<{ category: string; length: number; myRank: number | null }>(`/api/v1/auctions/queues/${categoryToWire(category)}/me`);
export const leaveQueue = (category: Category) => del<{ category: string; length: number; myRank: number | null }>(`/api/v1/auctions/queues/${categoryToWire(category)}/me`);

export const getMyPreferences = async (roundId: number) => (await get<{ itemIds: number[] }>(`/api/v1/auctions/rounds/${roundId}/preferences/me`)).itemIds;
/** A 200 means the list is stored (and will be part of the allocation). */
export const putMyPreferences = async (roundId: number, itemIds: number[]) => (await put<{ itemIds: number[] }>(`/api/v1/auctions/rounds/${roundId}/preferences/me`, { itemIds })).itemIds;

export type MyResults = { status: RoundStatus; items: AuctionItem[]; myWinCount: number };
export async function getMyResults(id: number): Promise<MyResults> {
  const r = await get<Ok<"/api/v1/auctions/rounds/{id}/results/me", "get">>(`/api/v1/auctions/rounds/${id}/results/me`);
  return { status: statusFromWire[r.status], items: r.items.map(itemFromWire), myWinCount: r.myWinCount };
}
