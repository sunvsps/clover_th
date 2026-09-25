import { ApiError, CATEGORIES, messageForCode, type AuctionItem, type Category, type Round } from "../../api";

/** Pure helpers of the auction screens (unit-tested separately). */

export type Phase = "draft" | "starting" | "open" | "ended" | "closed" | "cancelled";

/**
 * Where a round is on the SERVER's clock. `now` must come from the server clock (`serverClock.now()`), never from the
 * browser clock. "ended" = the window is over but the server has not finalized yet (the next poll shows CLOSED).
 */
export function phaseOf(round: Pick<Round, "status" | "opensAt" | "closesAt">, now: number): Phase {
  if (round.status !== "open") return round.status;
  if (round.opensAt && now < Date.parse(round.opensAt)) return "starting";
  if (round.closesAt && now >= Date.parse(round.closesAt)) return "ended";
  return "open";
}

/** Whole seconds until an instant, rounded up (3-2-1 style); never negative. */
export const secondsUntil = (iso: string | null, now: number) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0);

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Items by category in the fixed category order; untagged items (category null) come last as their own group. */
export function groupByCategory(items: AuctionItem[]): { category: Category | null; items: AuctionItem[] }[] {
  return [...CATEGORIES, null].map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter((g) => g.items.length > 0);
}

/** Move the element at `index` by `delta` positions (clamped); returns a new array. */
export function moveInList<T>(list: T[], index: number, delta: number): T[] {
  const to = Math.min(list.length - 1, Math.max(0, index + delta));
  if (index < 0 || index >= list.length || to === index) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

export const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const categoryNames: Record<Category, { en: string; th: string }> = {
  pet: { en: "Pet", th: "เพ็ท" },
  material: { en: "Material", th: "วัตถุดิบ" },
  gembox: { en: "GemBox", th: "กล่องเจม" },
  gear: { en: "Gear", th: "อุปกรณ์" },
  card: { en: "Card", th: "การ์ด" },
  relic: { en: "Relic", th: "โบราณวัตถุ" },
};
/** `null` = an untagged item. */
export const categoryLabel = (c: Category | null, isThai: boolean) => (c === null ? (isThai ? "ไม่ระบุหมวด" : "No category") : isThai ? categoryNames[c].th : categoryNames[c].en);

/** Text for a failed auction call: the winner's name, the cap, the wait time - else the translated code. */
export function auctionErrorText(err: unknown, isThai: boolean, ignOf: (memberId: string) => string): string {
  const t = (en: string, th: string) => (isThai ? th : en);
  if (!(err instanceof ApiError)) return t("Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
  if (err.code === "ITEM_ALREADY_CLAIMED") {
    const winner = (err.details.winner as { memberId?: string } | null | undefined)?.memberId;
    return winner ? t(`${ignOf(winner)} got this item first.`, `${ignOf(winner)} จองไอเท็มนี้ไปก่อนแล้ว`) : messageForCode(err.code, isThai);
  }
  if (err.code === "CLAIM_CAP_REACHED") {
    const cap = Number(err.details.winCap) || 5;
    return t(`You have reached the limit of ${cap} items in this round. Release one to claim another.`, `คุณจองครบ ${cap} ชิ้นในรอบนี้แล้ว ปล่อยหนึ่งชิ้นก่อนจึงจะจองชิ้นอื่นได้`);
  }
  if (err.code === "RATE_LIMITED") {
    return err.retryAfterSec
      ? t(`Too many requests. Please wait ${err.retryAfterSec} s and try again.`, `คำขอมากเกินไป กรุณารอ ${err.retryAfterSec} วินาทีแล้วลองอีกครั้ง`)
      : messageForCode(err.code, isThai);
  }
  if (err.code === "NOT_ELIGIBLE_FOR_CATEGORY") {
    const category = String(err.details.category ?? "").toLowerCase() as Category;
    return category in categoryNames
      ? t(`You were not in the ${categoryLabel(category, false)} queue when the round opened.`, `คุณไม่ได้อยู่ในคิว ${categoryLabel(category, true)} ตอนเปิดรอบ`)
      : messageForCode(err.code, isThai);
  }
  return err.userMessage(isThai);
}
