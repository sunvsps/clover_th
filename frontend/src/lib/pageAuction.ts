// Types and helpers for the page-based auction board (local/demo state; the backend has no API for it yet).
export type QueueCategory = "gear" | "card" | "relic";
export const queueCategories: { id: QueueCategory; label: string; labelTh: string }[] = [
  { id: "gear", label: "Gear", labelTh: "Gear (อุปกรณ์)" },
  { id: "card", label: "Card", labelTh: "Card (การ์ด)" },
  { id: "relic", label: "Relic", labelTh: "Relic (เรลิก)" },
];
export type QueueEntry = { member: string; joinedAt: number };
export type Queues = Record<QueueCategory, QueueEntry[]>;
export type QueueLogEntry = { id: number; time: number; round: number; category: QueueCategory; itemName: string; member: string; result: "taken" | "declined" };
/** One claim per member per category per round: member name -> item id. */
export type CategoryClaims = Record<QueueCategory, Record<string, number>>;
export const emptyClaims = (): CategoryClaims => ({ gear: {}, card: {}, relic: {} });
export const itemLabel = (itemId: number) => `Page ${Math.ceil(itemId / 4)} / Item ${((itemId - 1) % 4) + 1}`;
export const emptyQueues = (): Queues => ({ gear: [], card: [], relic: [] });

/** A member as the board sees it: display name + job id. */
export type BoardMember = { name: string; job: number };
