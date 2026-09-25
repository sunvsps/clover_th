import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ListOrdered, Lock, LockOpen, Package, Trash2, Users } from "lucide-react";
import {
  claimItem as apiClaimItem,
  getMyPreferences,
  listRounds,
  putMyPreferences,
  releaseItem as apiReleaseItem,
  usePolling,
  type AuctionItem,
  type Category,
  type RoundListEntry,
} from "../api";
import CategoryPill from "../components/CategoryPill";
import { categoryStripe } from "../components/categoryStyle";
import { useRound } from "../hooks/useRound";
import { useServerNow } from "../hooks/useServerNow";
import { auctionErrorText, categoryLabel, formatClock, phaseOf, secondsUntil } from "./auction/auctionModel";
import type { GuildMember } from "../data/guild";

type Item = {
  id: number;
  name: string;
  /** null = untagged (live-claim rounds only) */
  category: Category | null;
  status: "available" | "claimed";
  claimedBy?: string;
  /** queue rounds: the winner's queue position when the item was allocated */
  queuePos: number | null;
  /** the admin disabled it: it keeps its slot but can't be claimed or ranked */
  disabled: boolean;
};
const toLocalItem = (item: AuctionItem, claimedByIgn: string | undefined): Item => ({
  id: item.id,
  name: item.name,
  category: item.category,
  status: item.winner ? "claimed" : "available",
  claimedBy: claimedByIgn,
  queuePos: item.winner?.queuePos ?? null,
  disabled: item.disabled,
});

/** The open round first (either type), then the most recent closed one, then whatever is listed first. */
const defaultRound = (rounds: RoundListEntry[]) => rounds.find((r) => r.status === "open") ?? rounds.find((r) => r.status === "closed") ?? rounds[0] ?? null;

type Reservation = {
  member: string;
  items: string[];
};

const PAGES_PER_GROUP = 25;
const ITEMS_PER_PAGE = 4;

/** The reservation "paper trail" (who reserved what, and who has received it) still lives in this browser
 * (localStorage) — the server tracks winners itself, but not a separate "received" checklist. */
const STORE_KEY = "clover.pageAuction.v4";
type Persisted = {
  reservations: Reservation[];
  reservationRounds: Record<string, number>;
  receivedItems: string[];
};
function loadPersisted(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

type Props = {
  isThai: boolean;
  memberId: string;
  members: GuildMember[];
  notify: (message: string) => void;
  /** Takes the member to the "Auction queue" tab (a ranked-queue round only accepts members who were queued). */
  onGoToQueue: () => void;
};

/**
 * Page-based auction board, ported from feature/clover-th-reservation's PageAuctionView, showing the real rounds
 * (both types; a picker switches between them). Creating and starting/closing a round is done from the Admin page.
 * - Live claim: "Reserve" claims the item (`POST`/`DELETE .../claim`); timing, my count and the cap come from the server.
 * - Ranked queue: "Reserve" adds the item to my ranked list (`PUT .../preferences/me`, first reserved = rank 1). Only
 *   categories I was queued for when the round opened accept items (`eligibleCategories`); for any other category the
 *   button takes the member to the "Auction queue" tab instead. Items are allocated by queue order when it closes.
 */
export default function PageAuctionView({ isThai, memberId, members: guildMembers, notify, onGoToQueue }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const saved = useMemo(() => loadPersisted(), []);
  const myIgn = guildMembers.find((member) => member.id === memberId)?.ign ?? "";
  const myName = myIgn;
  const ignOf = (id: string) => guildMembers.find((member) => member.id === id)?.ign ?? id;
  const setNotice = notify;

  const roundList = usePolling(listRounds, { intervalMs: 6000, key: "pageBoardRounds" });
  const rounds = roundList.data ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const roundId = picked ?? defaultRound(rounds)?.id ?? null;
  const { round, refresh: refreshRound, apply: applyRound, error: roundError } = useRound(roundId, true);
  const isQueue = round?.type === "queueRanked";
  const eligible = new Set(round?.eligibleCategories ?? []);

  // Queue rounds: my ranked list (item ids, best first) as the server holds it; "Reserve" appends, "Remove" drops.
  const [myList, setMyList] = useState<number[]>([]);
  const [listRoundId, setListRoundId] = useState<number | null>(null);
  useEffect(() => {
    if (!round || round.type !== "queueRanked" || listRoundId === round.id) return;
    let cancelled = false;
    getMyPreferences(round.id).then(
      (ids) => {
        if (cancelled) return;
        setMyList(ids);
        setListRoundId(round.id);
      },
      () => !cancelled && setListRoundId(round.id),
    );
    return () => {
      cancelled = true;
    };
  }, [round, listRoundId]);
  const queueList = isQueue && listRoundId === round?.id ? myList : [];
  const serverNow = useServerNow(250, true);
  const phase = round ? phaseOf(round, serverNow) : null;
  const roundOpen = phase === "open";
  const timeLeft = round && phase === "open" ? secondsUntil(round.closesAt, serverNow) : 0;
  const startsIn = round && phase === "starting" ? secondsUntil(round.opensAt, serverNow) : 0;
  const winCap = round?.winCap ?? 5;
  const myWinCount = round?.myWinCount ?? 0;
  const reachedLimit = myWinCount >= winCap;
  const phaseText: Record<string, string> = {
    draft: t("Draft (admins only)", "ฉบับร่าง (เฉพาะแอดมิน)"),
    starting: t("Starting soon", "กำลังจะเริ่ม"),
    open: t("Open", "เปิดอยู่"),
    ended: t("Time is up: closing…", "หมดเวลา: กำลังปิดรอบ…"),
    closed: t("Closed", "ปิดแล้ว"),
    cancelled: t("Cancelled", "ยกเลิกแล้ว"),
  };

  const [currentPage, setCurrentPage] = useState(1); // page *group* (25 pages each)
  const [itemList, setItemList] = useState<Item[]>([]);
  const [busyItems, setBusyItems] = useState<Set<number>>(() => new Set());
  const [reservations, setReservations] = useState<Reservation[]>(saved.reservations ?? []);
  const [reservationRounds, setReservationRounds] = useState<Record<string, number>>(saved.reservationRounds ?? {});
  const [receivedItems, setReceivedItems] = useState<Set<string>>(() => new Set(saved.receivedItems ?? []));

  // Keeps itemList in sync with the real round on every poll.
  useEffect(() => {
    if (!round) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local display state from polled server data
    setItemList(round.items.map((item) => toLocalItem(item, item.winner ? ignOf(item.winner.memberId) : undefined)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  useEffect(() => {
    const snapshot: Persisted = { reservations, reservationRounds, receivedItems: [...receivedItems] };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  }, [reservations, reservationRounds, receivedItems]);

  const totalPages = Math.max(1, Math.ceil(itemList.length / ITEMS_PER_PAGE));
  const groupCount = Math.max(1, Math.ceil(totalPages / PAGES_PER_GROUP));
  const groupRange = (group: number) => ({ start: (group - 1) * PAGES_PER_GROUP + 1, end: Math.min(group * PAGES_PER_GROUP, totalPages) });
  const groupLabel = (group: number) => `${groupRange(group).start} - ${groupRange(group).end}`;
  const pageBlocks = useMemo(() => {
    const { start, end } = groupRange(currentPage);
    return Array.from({ length: end - start + 1 }, (_, index) => {
      const page = start + index;
      return { page, items: itemList.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemList, totalPages]);

  const itemLabel = (itemId: number) => {
    const index = itemList.findIndex((item) => item.id === itemId);
    if (index === -1) return `Item ${itemId}`;
    return `Page ${Math.ceil((index + 1) / ITEMS_PER_PAGE)} / Item ${(index % ITEMS_PER_PAGE) + 1}`;
  };
  const claimedCount = itemList.filter((item) => item.status === "claimed").length;
  const copy = {
    liveBoard: isThai ? "กระดานจองไอเท็มแบบเรียลไทม์" : "LIVE RESERVATION BOARD",
    dropList: isThai ? "รายการไอเท็ม" : "THE DROP LIST",
    available: isThai ? "ไอเท็มที่เปิดจอง" : "Available items",
    intro: isThai ? "ระบบการจองประมูลไอเท็ม Clover_TH Guild" : "Reserve your auction drops in a fair, visible queue for",
    reserve: isThai ? "จอง" : "Reserve",
    cancel: isThai ? "ยกเลิก" : "Remove",
    next: isThai ? "ถัดไป" : "Next",
    previous: isThai ? "ก่อนหน้า" : "Previous",
    summary: isThai ? "สรุปการจอง" : "Reservation summary",
    copyList: isThai ? "คัดลอกรายการ" : "Copy list",
    receivedAll: isThai ? "รับของทั้งหมด" : "Received all",
    undoAll: isThai ? "ยกเลิกรับทั้งหมด" : "Undo all",
    received: isThai ? "รับของแล้ว" : "Received",
    undo: isThai ? "ยกเลิก" : "Undo",
  };

  /**
   * Queue round: toggles the item in my ranked list and saves it (`PUT .../preferences/me`). Only categories I was
   * queued for when the round opened accept items; for any other category the member is sent to the queue tab.
   */
  async function toggleQueueItem(item: Item) {
    if (!round || busyItems.has(item.id)) return;
    if (item.category === null || !eligible.has(item.category)) {
      setNotice(
        t(
          `Join the ${categoryLabel(item.category, false)} queue first — a queue round only counts members who were queued when it opened.`,
          `ต้องลงคิว ${categoryLabel(item.category, true)} ก่อน — รอบคิวนับเฉพาะคนที่อยู่ในคิวตอนเปิดรอบ`,
        ),
      );
      onGoToQueue();
      return;
    }
    const inList = queueList.includes(item.id);
    const next = inList ? queueList.filter((id) => id !== item.id) : [...queueList, item.id];
    setBusyItems((b) => new Set(b).add(item.id));
    try {
      const stored = await putMyPreferences(round.id, next);
      setMyList(stored);
      setNotice(
        inList
          ? t(`${item.name} removed from your list.`, `นำ ${item.name} ออกจากรายการแล้ว`)
          : t(`${item.name} added to your list (#${stored.indexOf(item.id) + 1}).`, `เพิ่ม ${item.name} ในรายการแล้ว (อันดับ ${stored.indexOf(item.id) + 1})`),
      );
    } catch (err) {
      setNotice(auctionErrorText(err, isThai, ignOf));
    } finally {
      setBusyItems((b) => {
        const nextBusy = new Set(b);
        nextBusy.delete(item.id);
        return nextBusy;
      });
    }
  }

  /** Claim/release an item — calls the real auction API; the round is authoritative on whether this is allowed. */
  async function claimItem(itemId: number) {
    if (!round || busyItems.has(itemId)) return;
    const current = itemList.find((item) => item.id === itemId);
    const mine = current?.status === "claimed" && current.claimedBy === myName;
    const label = itemLabel(itemId);
    setBusyItems((b) => new Set(b).add(itemId));
    try {
      const result = mine ? await apiReleaseItem(round.id, itemId) : await apiClaimItem(round.id, itemId);
      applyRound(result.item, result.myWinCount);
      if (mine) {
        setReservations((current) =>
          current.map((reservation) => (reservation.member === myName ? { ...reservation, items: reservation.items.filter((item) => item !== label) } : reservation)).filter((reservation) => reservation.items.length > 0),
        );
        setReservationRounds((rounds) => {
          const next = { ...rounds };
          delete next[`${myName}:${label}`];
          return next;
        });
        setNotice(`${label} reservation removed.`);
      } else {
        setReservations((current) => {
          const existing = current.find((reservation) => reservation.member === myName);
          if (existing) return current.map((reservation) => (reservation.member === myName ? { ...reservation, items: [...reservation.items, label] } : reservation));
          return [...current, { member: myName, items: [label] }];
        });
        setReservationRounds((rounds) => ({ ...rounds, [`${myName}:${label}`]: round.id }));
        setNotice(`${label} is reserved for ${myName}.`);
      }
    } catch (err) {
      setNotice(auctionErrorText(err, isThai, ignOf));
    } finally {
      setBusyItems((b) => {
        const next = new Set(b);
        next.delete(itemId);
        return next;
      });
      refreshRound(); // show the truth, e.g. who won the item we lost
    }
  }

  function copySummary() {
    const auctionDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
    const rounds = [...new Set(reservations.flatMap((reservation) => reservation.items.map((item) => reservationRounds[`${reservation.member}:${item}`] ?? 0)))].sort((a, b) => a - b);
    const summary = rounds
      .flatMap((roundId) => {
        const roundReservations = reservations
          .map((reservation) => ({
            ...reservation,
            items: reservation.items
              .filter((item) => (reservationRounds[`${reservation.member}:${item}`] ?? 0) === roundId)
              .sort((firstItem, secondItem) => {
                const firstMatch = firstItem.match(/Page (\d+) \/ Item (\d+)/);
                const secondMatch = secondItem.match(/Page (\d+) \/ Item (\d+)/);
                if (!firstMatch || !secondMatch) return 0;
                return Number(firstMatch[1]) - Number(secondMatch[1]) || Number(firstMatch[2]) - Number(secondMatch[2]);
              }),
          }))
          .filter((reservation) => reservation.items.length > 0);
        const roundItemCount = roundReservations.reduce((total, reservation) => total + reservation.items.length, 0);
        return [
          `Clover_TH Auction - Round #${roundId}`,
          `Auction date: ${auctionDate}`,
          `${roundReservations.length} members · ${roundItemCount} items reserved`,
          "",
          ...roundReservations.flatMap((reservation, index) => [`${index + 1}. ${reservation.member}`, ...reservation.items.map((item) => `   • ${item.replace(" / ", " — ")}`), ""]),
        ];
      })
      .join("\n")
      .trim();
    navigator.clipboard?.writeText(summary);
    setNotice("Readable reservation summary copied to clipboard.");
  }

  function markItemReceived(member: string, item: string) {
    if (member !== myName) return;
    const key = `${member}:${item}`;
    setReceivedItems((currentItems) => new Set(currentItems).add(key));
    setNotice(`${item} marked as received.`);
  }

  function markAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== myName) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.add(`${member}:${item}`));
      return nextItems;
    });
    setNotice("All reserved items marked as received.");
  }

  function undoAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== myName) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.delete(`${member}:${item}`));
      return nextItems;
    });
    setNotice("All received marks removed.");
  }

  function undoReceived(member: string, item: string) {
    if (member !== myName) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      nextItems.delete(`${member}:${item}`);
      return nextItems;
    });
    setNotice(`${item} returned to pending.`);
  }

  return (
    <div id="top" className="content page-board">
      <section className="intro-row">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> {copy.liveBoard}
          </p>
          <h1>
            Guild item queue<span>.</span>
          </h1>
          <p className="intro-copy">
            {copy.intro}
            {isThai ? (
              ""
            ) : (
              <>
                {" "}
                <strong>Clover_TH</strong>.
              </>
            )}
          </p>
        </div>
        <div className="season-card">
          <span>{round ? (round.type === "liveClaim" ? "LIVE CLAIM" : "RANKED QUEUE") : "--"}</span>
          <strong>{round?.name ?? t("No round yet", "ยังไม่มีรอบ")}</strong>
          <small>{phase === "open" ? t(`${formatClock(timeLeft)} remaining`, `เหลือ ${formatClock(timeLeft)}`) : phase ? phaseText[phase] : ""}</small>
          {isQueue ? (
            <em className="quota">
              <ListOrdered size={11} /> {t("My list", "รายการของฉัน")} {queueList.length}
            </em>
          ) : (
            <em className={`quota ${reachedLimit ? "full" : ""}`}>
              <Package size={11} /> {isThai ? "จองแล้ว" : "Reserved"} {myWinCount}/{winCap}
            </em>
          )}
        </div>
      </section>

      {rounds.length > 1 && (
        <label className="round-picker">
          <span>{t("Round", "รอบ")}</span>
          <select value={roundId ?? ""} onChange={(e) => setPicked(Number(e.target.value))} aria-label={t("Round", "รอบ")}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} {r.name} · {r.type === "liveClaim" ? t("live claim", "จองสด") : t("ranked queue", "จัดอันดับคิว")} · {phaseText[r.status] ?? r.status}
              </option>
            ))}
          </select>
        </label>
      )}

      {roundList.error && (
        <p className="schedule-error" role="alert">
          {roundList.error.userMessage(isThai)}
        </p>
      )}
      {roundError && (
        <p className="schedule-error" role="alert">
          {roundError.userMessage(isThai)}
        </p>
      )}
      {!round && !roundList.error && (
        <p className="empty-search" role="status">
          {roundList.data ? t("There is no auction round yet. An admin will open one.", "ยังไม่มีรอบประมูล แอดมินจะเปิดรอบให้") : t("Loading…", "กำลังโหลด…")}
        </p>
      )}

      {round && phase && (
        <section className={`round-panel ${phase === "open" ? "" : "closed"}`}>
          <div className="round-status">
            <span className="timer-icon">{phase === "open" ? <LockOpen size={17} /> : <Lock size={17} />}</span>
            <div>
              <strong>{phaseText[phase]}</strong>
              <small>
                {isQueue
                  ? eligible.size === 0 && phase === "open"
                    ? t("You were not in any queue when this round opened. Join a queue to take part in the next one.", "คุณไม่ได้อยู่ในคิวใดตอนเปิดรอบนี้ ลงคิวไว้เพื่อมีสิทธิ์ในรอบถัดไป")
                    : t("Reserve the items you want, best first. When the round closes, one item per category goes out in queue order.", "จองไอเท็มที่ต้องการ (ชิ้นแรกคืออันดับ 1) เมื่อปิดรอบ ระบบแจกหมวดละ 1 ชิ้นตามลำดับคิว")
                  : t(`Claim up to ${winCap} items. First come, first served.`, `จองได้สูงสุด ${winCap} ชิ้น ใครมาก่อนได้ก่อน`)}
              </small>
            </div>
          </div>
          <div className="timer">
            <span>{t("TIME LEFT", "เวลาที่เหลือ")}</span>
            <strong>{phase === "open" ? formatClock(timeLeft) : phase === "starting" ? formatClock(startsIn) : "--:--"}</strong>
          </div>
        </section>
      )}

      {itemList.length > 0 && (
        <>
          <section className="section-heading">
            <div>
              <p className="eyebrow">{copy.dropList}</p>
              <h2>{copy.available}</h2>
            </div>
            <div className="top-page-nav">
              <span>
                Pages <strong>{groupLabel(currentPage)}</strong> <em className="page-total">/ {totalPages}</em>
              </span>
              {groupCount > 1 && (
                <>
                  <button className="page-group-button" type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((group) => group - 1)}>
                    <ArrowLeft size={14} /> {copy.previous}
                  </button>
                  <button className="page-group-button" type="button" disabled={currentPage === groupCount} onClick={() => setCurrentPage((group) => group + 1)}>
                    {copy.next} <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </section>
          <section className="page-blocks" aria-label="Auction item pages">
            {pageBlocks.map((pageBlock) => (
              <section className="page-block" key={pageBlock.page} aria-label={`Page ${pageBlock.page}`}>
                <div className="page-label">
                  Page <strong>{pageBlock.page}</strong>
                </div>
                <div className="item-grid">
                  {pageBlock.items.map((item) => {
                    const isMine = item.status === "claimed" && item.claimedBy === myName;
                    const busy = busyItems.has(item.id);
                    if (item.disabled) {
                      return (
                        <article className="item-card cat-stripe item-off" key={item.id}>
                          <div className="item-info">
                            <h3>{item.name}</h3>
                            <span className="cat-pill none">{t("Disabled", "ปิดใช้งาน")}</span>
                          </div>
                          <button className="claim-button" type="button" disabled>
                            <Lock size={14} /> {t("Disabled", "ปิดใช้งาน")}
                          </button>
                        </article>
                      );
                    }
                    if (isQueue) {
                      const rank = queueList.indexOf(item.id);
                      const inList = rank !== -1;
                      const canQueue = item.category !== null && eligible.has(item.category);
                      return (
                        <article className={`item-card ${item.status} ${inList ? "mine" : ""} ${categoryStripe(item.category)}`} key={item.id}>
                          <div className="item-info">
                            <h3>{item.name}</h3>
                            {item.status === "claimed" ? (
                              <small className="reserved-by">
                                {t("Won by", "ได้ของ")} {item.claimedBy}
                                {item.queuePos ? ` · ${t("queue", "คิว")} #${item.queuePos}` : ""}
                              </small>
                            ) : (
                              <>
                                <CategoryPill category={item.category} isThai={isThai} />
                                {inList && <small>{t(`My #${rank + 1}`, `อันดับ ${rank + 1} ของฉัน`)}</small>}
                              </>
                            )}
                          </div>
                          <button
                            className="claim-button"
                            type="button"
                            // only while the round is open; then a member not queued for this category is sent to the queue tab
                            disabled={busy || item.status === "claimed" || !roundOpen}
                            onClick={() => void toggleQueueItem(item)}
                          >
                            {!roundOpen ? (
                              <>
                                <Lock size={14} /> {phase === "draft" || phase === "starting" ? t("Not open yet", "ยังไม่เปิดรอบ") : t("Round closed", "ปิดรอบแล้ว")}
                              </>
                            ) : !canQueue ? (
                              <>
                                <ListOrdered size={14} /> {t("Join queue first", "ต้องลงคิวก่อน")}
                              </>
                            ) : inList ? (
                              <>
                                <Trash2 size={14} /> {copy.cancel}
                              </>
                            ) : (
                              <>
                                <Package size={14} /> {copy.reserve}
                              </>
                            )}
                          </button>
                        </article>
                      );
                    }
                    return (
                      <article className={`item-card ${item.status} ${categoryStripe(item.category)}`} key={item.id}>
                        <div className="item-info">
                          <h3>{item.name}</h3>
                          <CategoryPill category={item.category} isThai={isThai} />
                          {item.status === "claimed" && <small className="reserved-by">Reserved by {item.claimedBy}</small>}
                        </div>
                        <button
                          className="claim-button"
                          type="button"
                          // a categorized item (Gear/Card/…) can't be claimed in a live-claim round: only untagged items can
                          disabled={busy || !roundOpen || item.category !== null || (item.status === "claimed" && !isMine) || (reachedLimit && !isMine)}
                          title={item.category !== null ? t("Only items without a category can be claimed in a live-claim round.", "รอบจองสดจองได้เฉพาะไอเท็มที่ไม่มีหมวด") : undefined}
                          onClick={() => void claimItem(item.id)}
                        >
                          {item.category !== null ? (
                            <>
                              <Lock size={14} /> {t("Not claimable", "จองไม่ได้")}
                            </>
                          ) : isMine ? (
                            <>
                              <Trash2 size={14} /> {copy.cancel}
                            </>
                          ) : (
                            <>
                              <Package size={14} /> {copy.reserve}
                            </>
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>

          <div className="page-group-bottom">
            <span>
              Pages <strong>{groupLabel(currentPage)}</strong> <em className="page-total">/ {totalPages}</em>
            </span>
            {groupCount > 1 && (
              <span className="page-group-buttons">
                <button className="page-group-button" type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((group) => group - 1)}>
                  <ArrowLeft size={14} /> {copy.previous}
                </button>
                <button className="page-group-button" type="button" disabled={currentPage === groupCount} onClick={() => setCurrentPage((group) => group + 1)}>
                  {copy.next} <ArrowRight size={14} />
                </button>
              </span>
            )}
          </div>
        </>
      )}

      <section className="summary-section">
        <div className="section-heading summary-heading">
          <div>
            <p className="eyebrow">THE PAPER TRAIL</p>
            <h2>{copy.summary}</h2>
          </div>
          <button className="copy-button" type="button" onClick={copySummary}>
            <Copy size={15} /> {copy.copyList}
          </button>
        </div>
        <div className="summary-meta">
          <span>
            <Users size={15} /> {reservations.length} members
          </span>
          <span>
            <Package size={15} /> {claimedCount} items reserved
          </span>
        </div>
        <div className="summary-grid">
          {reservations.map((reservation) => {
            const isOwnReservation = reservation.member === myIgn.trim();
            const sortedItems = [...reservation.items].sort((firstItem, secondItem) => {
              const firstMatch = firstItem.match(/Page (\d+) \/ Item (\d+)/);
              const secondMatch = secondItem.match(/Page (\d+) \/ Item (\d+)/);
              if (!firstMatch || !secondMatch) return 0;
              return Number(firstMatch[1]) - Number(secondMatch[1]) || Number(firstMatch[2]) - Number(secondMatch[2]);
            });
            const allReceived = sortedItems.every((item) => receivedItems.has(`${reservation.member}:${item}`));
            return (
              <article className="summary-card" key={reservation.member}>
                <div className="member-heading">
                  <span className="member-avatar">{reservation.member.charAt(0).toUpperCase()}</span>
                  <strong>{reservation.member}</strong>
                  <span className="item-count">
                    {sortedItems.length} {sortedItems.length === 1 ? "item" : "items"}
                  </span>
                  {isOwnReservation && (
                    <button type="button" className="receive-all-button" onClick={() => (allReceived ? undoAllReceived(reservation.member, sortedItems) : markAllReceived(reservation.member, sortedItems))}>
                      {allReceived ? copy.undoAll : copy.receivedAll}
                    </button>
                  )}
                </div>
                {sortedItems.map((item) => {
                  const isReceived = receivedItems.has(`${reservation.member}:${item}`);
                  return (
                    <div className={`reserved-item ${isReceived ? "received" : ""}`} key={item}>
                      <span />
                      {item}
                      {isReceived ? (
                        <button type="button" className="undo-received-button" onClick={() => undoReceived(reservation.member, item)}>
                          {copy.undo}
                        </button>
                      ) : isOwnReservation ? (
                        <button type="button" className="receive-button" onClick={() => markItemReceived(reservation.member, item)}>
                          <Check size={12} /> {copy.received}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
