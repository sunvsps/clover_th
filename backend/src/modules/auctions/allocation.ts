/**
 * Type-2 allocation (design 7.2, FR-3.7/3.8/3.12). PURE: no database, no clock, no randomness. The same
 * inputs always give the same awards, so a stored snapshot can be replayed and must reproduce the stored result.
 */
export const ALGORITHM_VERSION = 1;

export const QUEUE_CATEGORIES = ['GEAR', 'CARD', 'RELIC'] as const;
export type QueueCategory = (typeof QUEUE_CATEGORIES)[number];

export type AllocItem = { id: number; category: string };

/** Member ids in snapshot (queue) order, per category. Position = index + 1. */
export type QueueSnapshot = Partial<Record<string, string[]>>;

/** memberId -> item ids in rank order (ranks dense over the whole list; items span categories). */
export type Preferences = ReadonlyMap<string, readonly number[]>;

export type Award = { itemId: number; memberId: string; category: string; position: number };

export function allocate(queues: QueueSnapshot, items: readonly AllocItem[], prefs: Preferences): Award[] {
  const awards: Award[] = [];
  const categories = [...new Set(items.map((i) => i.category))].sort();
  for (const category of categories) {
    const free = new Set(items.filter((i) => i.category === category).map((i) => i.id));
    const inCategory = new Set(free);
    const queue = queues[category] ?? [];
    for (const [idx, memberId] of queue.entries()) {
      // the member's list restricted to this category, in rank order (the list is already ordered by rank)
      const pick = (prefs.get(memberId) ?? []).find((itemId) => inCategory.has(itemId) && free.has(itemId));
      if (pick === undefined) continue;
      awards.push({ itemId: pick, memberId, category, position: idx + 1 });
      free.delete(pick); // at most one win per member per category: the member is visited once per category
    }
  }
  return awards;
}
