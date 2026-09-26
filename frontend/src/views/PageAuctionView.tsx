import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Copy, Gavel, ListOrdered, Lock, LockOpen, Package, Trash2, Users, Zap } from "lucide-react";
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

const PAGES_PER_GROUP = 25;
const ITEMS_PER_PAGE = 4;
const MAX_ROUND_CHIPS = 10;

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
  const myIgn = guildMembers.find((member) => member.id === memberId)?.ign ?? "";
  const myName = myIgn;
  const ignOf = (id: string) => guildMembers.find((member) => member.id === id)?.ign ?? id;
  const setNotice = notify;

  const roundList = usePolling(listRounds, { intervalMs: 6000, key: "pageBoardRounds" });
  const rounds = roundList.data ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const roundId = picked ?? defaultRound(rounds)?.id ?? null;
  // The picker shows at most MAX_ROUND_CHIPS rounds: open ones and the one being viewed always, then the newest
  // (the list comes newest first); older rounds are not offered.
  const shownRounds = useMemo(() => {
    const rounds = roundList.data ?? [];
    const keep = rounds.filter((r) => r.status === "open" || r.id === roundId);
    const rest = rounds.filter((r) => !keep.includes(r)).slice(0, Math.max(0, MAX_ROUND_CHIPS - keep.length));
    return [...keep, ...rest].sort((a, b) => b.id - a.id);
  }, [roundList.data, roundId]);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const [chipEdges, setChipEdges] = useState({ start: true, end: true });
  const measureChips = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const next = { start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 };
    setChipEdges((cur) => (cur.start === next.start && cur.end === next.end ? cur : next));
  }, []);
  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    measureChips();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureChips);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureChips, shownRounds.length]);
  const scrollChips = (dir: 1 | -1) => chipsRef.current?.scrollBy({ left: dir * chipsRef.current.clientWidth * 0.8, behavior: "smooth" });
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

  // Keeps itemList in sync with the real round on every poll.
  useEffect(() => {
    if (!round) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local display state from polled server data
    setItemList(round.items.map((item) => toLocalItem(item, item.winner ? ignOf(item.winner.memberId) : undefined)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

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
  /** Who holds what in the round on screen, from the server's winners, in slot order (first holder first). */
  const reservations = useMemo(() => {
    const byMember = new Map<string, string[]>();
    itemList.forEach((item, index) => {
      if (item.status !== "claimed" || !item.claimedBy) return;
      const label = `Page ${Math.floor(index / ITEMS_PER_PAGE) + 1} / Item ${(index % ITEMS_PER_PAGE) + 1}`;
      byMember.set(item.claimedBy, [...(byMember.get(item.claimedBy) ?? []), label]);
    });
    return [...byMember].map(([member, items]) => ({ member, items }));
  }, [itemList]);
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
          ? t(`${itemLabel(item.id)} removed from your list.`, `นำ ${itemLabel(item.id)} ออกจากรายการแล้ว`)
          : t(`${itemLabel(item.id)} added to your list (#${stored.indexOf(item.id) + 1}).`, `เพิ่ม ${itemLabel(item.id)} ในรายการแล้ว (อันดับ ${stored.indexOf(item.id) + 1})`),
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
      setNotice(mine ? t(`${label} reservation removed.`, `ยกเลิกการจอง ${label} แล้ว`) : t(`${label} is reserved for ${myName}.`, `จอง ${label} ให้ ${myName} แล้ว`));
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
    if (!round) return;
    const auctionDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
    const summary = [
      `Clover_TH Auction - Round #${round.id} ${round.name}`,
      `Auction date: ${auctionDate}`,
      `${reservations.length} members · ${claimedCount} items reserved`,
      "",
      ...reservations.flatMap((reservation, index) => [`${index + 1}. ${reservation.member}`, ...reservation.items.map((item) => `   • ${item.replace(" / ", " — ")}`), ""]),
    ]
      .join("\n")
      .trim();
    navigator.clipboard?.writeText(summary);
    setNotice(t("Reservation summary copied to clipboard.", "คัดลอกสรุปการจองแล้ว"));
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
        <section className="round-picker" aria-labelledby="round-picker-label">
          <p className="eyebrow" id="round-picker-label">
            <Gavel size={12} /> {t("ROUNDS", "รอบประมูล")} <em>{shownRounds.length}</em>
            {rounds.length > shownRounds.length && <small>{t(`latest ${shownRounds.length} of ${rounds.length}`, `ล่าสุด ${shownRounds.length} จาก ${rounds.length} รอบ`)}</small>}
          </p>
          <div className={`round-chips-wrap ${chipEdges.start ? "" : "fade-start"} ${chipEdges.end ? "" : "fade-end"}`}>
            <button type="button" className="round-chips-nav prev" onClick={() => scrollChips(-1)} disabled={chipEdges.start} aria-label={t("Scroll rounds left", "เลื่อนรอบไปทางซ้าย")}>
              <ChevronLeft size={16} />
            </button>
            <div className="round-chips" role="radiogroup" aria-labelledby="round-picker-label" ref={chipsRef} onScroll={measureChips}>
              {shownRounds.map((r) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={r.id === roundId}
                  key={r.id}
                  className={`round-chip status-${r.status} ${r.id === roundId ? "active" : ""}`}
                  onClick={() => setPicked(r.id)}
                >
                  <span className="round-chip-dot" aria-hidden="true" />
                  <span className="round-chip-main">
                    <strong>
                      <em>#{r.id}</em> {r.name}
                    </strong>
                    <small>
                      {r.type === "liveClaim" ? <Zap size={11} /> : <ListOrdered size={11} />} {r.type === "liveClaim" ? t("Live claim", "จองสด") : t("Ranked queue", "จัดอันดับคิว")}
                    </small>
                  </span>
                  <span className={`tag status-${r.status}`}>{phaseText[r.status] ?? r.status}</span>
                </button>
              ))}
            </div>
            <button type="button" className="round-chips-nav next" onClick={() => scrollChips(1)} disabled={chipEdges.end} aria-label={t("Scroll rounds right", "เลื่อนรอบไปทางขวา")}>
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
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
                  {pageBlock.items.map((item, slot) => {
                    // numbered 1-4 within the page, same as the admin round form; the stored name is "Item N" for the whole round
                    const slotName = `Item ${slot + 1}`;
                    const isMine = item.status === "claimed" && item.claimedBy === myName;
                    const busy = busyItems.has(item.id);
                    if (item.disabled) {
                      return (
                        <article className="item-card cat-stripe item-off" key={item.id}>
                          <div className="item-info">
                            <h3>{slotName}</h3>
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
                      // green frame: an item I won; while the round has not closed yet, also the items on my list
                      const framed = item.status === "claimed" ? item.claimedBy === myName : inList && phase !== "closed" && phase !== "cancelled";
                      return (
                        <article className={`item-card ${item.status} ${framed ? "mine" : ""} ${categoryStripe(item.category)}`} key={item.id}>
                          <div className="item-info">
                            <h3>{slotName}</h3>
                            {/* same layout as a live-claim card: the category tag stays, the holder goes underneath */}
                            <CategoryPill category={item.category} isThai={isThai} />
                            {item.status === "claimed" ? (
                              <small className="reserved-by">
                                {t("Won by", "ได้ของ")} {item.claimedBy}
                                {item.queuePos ? ` · ${t("queue", "คิว")} #${item.queuePos}` : ""}
                              </small>
                            ) : (
                              inList && <small className="reserved-by">{t(`My #${rank + 1}`, `อันดับ ${rank + 1} ของฉัน`)}</small>
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
                      <article className={`item-card ${item.status} ${isMine ? "mine" : ""} ${categoryStripe(item.category)}`} key={item.id}>
                        <div className="item-info">
                          <h3>{slotName}</h3>
                          <CategoryPill category={item.category} isThai={isThai} />
                          {item.status === "claimed" && <small className="reserved-by">{t("Reserved by", "จองโดย")} {item.claimedBy}</small>}
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
          <button className="copy-button" type="button" onClick={copySummary} disabled={reservations.length === 0}>
            <Copy size={15} /> {copy.copyList}
          </button>
        </div>
        <div className="summary-meta">
          <span>
            <Users size={15} /> {reservations.length} {t("members", "คน")}
          </span>
          <span>
            <Package size={15} /> {claimedCount} {t("items reserved", "ชิ้นที่จองแล้ว")}
          </span>
        </div>
        <div className="summary-grid">
          {reservations.map((reservation) => (
            <article className={`summary-card ${reservation.member === myName ? "mine" : ""}`} key={reservation.member}>
              <div className="member-heading">
                <span className="member-avatar">{reservation.member.charAt(0).toUpperCase()}</span>
                <strong>{reservation.member}</strong>
                <span className="item-count">
                  {reservation.items.length} {reservation.items.length === 1 ? "item" : "items"}
                </span>
              </div>
              {reservation.items.map((item) => (
                <div className="reserved-item" key={item}>
                  <span />
                  {item}
                </div>
              ))}
            </article>
          ))}
          {reservations.length === 0 && <p className="empty-search">{t("Nobody has reserved an item in this round yet.", "รอบนี้ยังไม่มีใครจองไอเท็ม")}</p>}
        </div>
      </section>
    </div>
  );
}
