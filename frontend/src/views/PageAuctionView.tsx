import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Lock, LockOpen, Package, Tag, Trash2, Users, X } from "lucide-react";
import { getQueues, usePolling, type Category } from "../api";
import type { GuildMember } from "../data/guild";

/** The three categories that have a real queue (see api/auctions.ts's QUEUE_CATEGORIES). */
type LockCategory = "gear" | "card" | "relic";
const CATEGORY_META: { id: LockCategory; label: string; labelTh: string }[] = [
  { id: "gear", label: "Gear", labelTh: "เกียร์" },
  { id: "card", label: "Card", labelTh: "การ์ด" },
  { id: "relic", label: "Relic", labelTh: "เรลิก" },
];
type CategoryClaims = Record<LockCategory, Record<string, number>>; // category -> memberId -> itemId
const emptyClaims = (): CategoryClaims => ({ gear: {}, card: {}, relic: {} });
const itemLabel = (itemId: number) => `Page ${Math.ceil(itemId / 4)} / Item ${((itemId - 1) % 4) + 1}`;

type Item = {
  id: number;
  name: string;
  rarity: "Rare" | "Epic" | "Legendary";
  status: "available" | "claimed";
  claimedBy?: string;
};

type Reservation = {
  member: string;
  items: string[];
};

const MAX_PAGES = 100;
const DEFAULT_PAGES = 50;
const PAGES_PER_GROUP = 25;
const ITEMS_PER_PAGE = 4;

const items: Item[] = Array.from({ length: MAX_PAGES * ITEMS_PER_PAGE }, (_, index) => {
  const number = index + 1;

  return {
    id: number,
    name: `Item ${String(number).padStart(2, "0")}`,
    rarity: number % 7 === 0 ? "Legendary" : number % 3 === 0 ? "Epic" : "Rare",
    status: "available",
  };
});

const MAX_RESERVATIONS = 5;
/** Board state lives in this browser (localStorage) until the backend has an API for page-based rounds. Who is in
 * which queue and in what order, however, comes live from the real auction queue API (see `getQueues` below) — this
 * page never writes to that queue itself; joining/leaving it is still done from the real "Auction queue" tab. */
const STORE_KEY = "clover.pageAuction.v2";
type Persisted = {
  totalPages: number;
  roundNumber: number;
  pageCategories: Record<number, LockCategory>;
  categoryClaims: CategoryClaims;
  slotRankings: Record<number, string[]>;
  itemList: Item[];
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
  isAdmin: boolean;
  memberId: string;
  members: GuildMember[];
  notify: (message: string) => void;
  /** Takes the member to the real "Auction queue" tab (joining/leaving a queue happens there, not on this page). */
  onGoToQueue: () => void;
};

/**
 * Page-based auction board, ported from feature/clover-th-reservation's PageAuctionView. The board itself (pages,
 * claims, reservation summary) still lives entirely in this browser (localStorage) — nothing here talks to the
 * auction round API yet. The category-lock feature (admin tags pages as Gear/Card/Relic; only queued members may
 * claim a tagged page, in queue order) reads its queue membership from the REAL queue API (`GET /auctions/queues`)
 * instead of a local mock queue, so it reflects who has actually joined a queue elsewhere in the app. It only
 * *reads* that queue: joining/leaving is still done from the real "Auction queue" tab, and resolving a locked round
 * here does not remove the winner from the real queue (there is no real round behind this page to do that).
 */
export default function PageAuctionView({ isThai, isAdmin, memberId, members: guildMembers, notify, onGoToQueue }: Props) {
  const saved = useMemo(() => loadPersisted(), []);
  const isAuthenticated = true;
  const myIgn = guildMembers.find((member) => member.id === memberId)?.ign ?? "";
  const myName = myIgn;
  const ignOf = (id: string) => guildMembers.find((member) => member.id === id)?.ign ?? id;
  const setNotice = notify;

  const queuesPoll = usePolling(getQueues, { intervalMs: 6000, key: "pageBoardQueues" });
  const queueOf = (category: LockCategory) => queuesPoll.data?.find((q) => q.category === (category as Category)) ?? { category: category as Category, length: 0, myRank: null, entries: [] };
  const inQueue = (category: LockCategory, id: string) => queueOf(category).entries.some((entry) => entry.memberId === id);
  const rankedClaimants = (itemId: number, category: LockCategory) => {
    const entries = queueOf(category).entries;
    return Object.entries(categoryClaims[category])
      .filter(([, claimed]) => claimed === itemId)
      .map(([id]) => id)
      .sort((a, b) => (entries.find((e) => e.memberId === a)?.rank ?? Infinity) - (entries.find((e) => e.memberId === b)?.rank ?? Infinity));
  };

  const [currentPage, setCurrentPage] = useState(1); // page *group* (25 pages each)
  const [totalPages, setTotalPages] = useState(saved.totalPages ?? DEFAULT_PAGES);
  const [roundNumber, setRoundNumber] = useState(saved.roundNumber ?? 0);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [isAuctionStarted, setIsAuctionStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(15);
  // A round is either for normal pages or for tagged (locked) pages; both share the same timer.
  const [roundMode, setRoundMode] = useState<"normal" | "locked">("normal");
  const [pageCategories, setPageCategories] = useState<Record<number, LockCategory>>(saved.pageCategories ?? {});
  const [pendingPageCategories, setPendingPageCategories] = useState<Record<number, LockCategory>>({});
  const [categoryClaims, setCategoryClaims] = useState<CategoryClaims>(() => saved.categoryClaims ?? emptyClaims());
  const [slotRankings, setSlotRankings] = useState<Record<number, string[]>>(saved.slotRankings ?? {});
  const [roundResolved, setRoundResolved] = useState(true);
  const [adminPagePickerOpen, setAdminPagePickerOpen] = useState(false);
  const [adminPagePickerGroup, setAdminPagePickerGroup] = useState(1);
  const [pickerSelection, setPickerSelection] = useState<Set<number>>(() => new Set());
  const [itemList, setItemList] = useState<Item[]>(saved.itemList ?? items);
  const [reservations, setReservations] = useState<Reservation[]>(saved.reservations ?? []);
  const [reservationRounds, setReservationRounds] = useState<Record<string, number>>(saved.reservationRounds ?? {});
  const [receivedItems, setReceivedItems] = useState<Set<string>>(() => new Set(saved.receivedItems ?? []));
  const [roundEndedNotice, setRoundEndedNotice] = useState(false);

  useEffect(() => {
    const snapshot: Persisted = { totalPages, roundNumber, pageCategories, categoryClaims, slotRankings, itemList, reservations, reservationRounds, receivedItems: [...receivedItems] };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  }, [totalPages, roundNumber, pageCategories, categoryClaims, slotRankings, itemList, reservations, reservationRounds, receivedItems]);

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

  function updateTotalPages(value: number) {
    const next = Math.min(MAX_PAGES, Math.max(1, Math.round(value) || 1));
    setTotalPages(next);
    setCurrentPage((group) => Math.min(group, Math.max(1, Math.ceil(next / PAGES_PER_GROUP))));
    setPageCategories((current) => Object.fromEntries(Object.entries(current).filter(([page]) => Number(page) <= next)));
  }
  const myClaimedCount = itemList.filter((item) => item.status === "claimed" && item.claimedBy === myName).length;
  const reachedLimit = myClaimedCount >= MAX_RESERVATIONS;
  const pageOf = (itemId: number) => Math.ceil(itemId / 4);
  const categoryOfItem = (itemId: number): LockCategory | undefined => pageCategories[pageOf(itemId)];
  const categoryLabel = (category: LockCategory) => {
    const entry = CATEGORY_META.find((item) => item.id === category);
    return isThai ? (entry?.labelTh ?? category) : (entry?.label ?? category);
  };
  const pagesByCategory = (source: Record<number, LockCategory>) =>
    CATEGORY_META.map((category) => ({
      category: category.id,
      pages: Object.entries(source)
        .filter(([, value]) => value === category.id)
        .map(([page]) => Number(page))
        .sort((a, b) => a - b),
    }));
  const claimedCount = itemList.filter((item) => item.status === "claimed").length;
  const hasTaggedPages = Object.keys(pageCategories).length > 0;
  const isAuctionClosed = !isAuctionStarted || countdown !== null || timeLeft <= 0;
  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`;
  const lockedRoundOpen = !isAuctionClosed && roundMode === "locked";
  const normalRoundOpen = !isAuctionClosed && roundMode === "normal";
  const copy = {
    liveBoard: isThai ? "กระดานจองไอเท็มแบบเรียลไทม์" : "LIVE RESERVATION BOARD",
    guildAuction: isThai ? "ประมูลไอเท็มกิลด์" : "Guild auction",
    waiting: isThai ? "รอแอดมินเริ่มประมูล" : "Waiting for admin to start",
    auctionOpen: isThai ? "เปิดประมูลแล้ว" : "Auction is open",
    timeLeft: isThai ? "เวลาที่เหลือ" : "TIME LEFT",
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
    roundComplete: isThai ? "รอบการประมูลสิ้นสุดแล้ว" : "ROUND COMPLETE",
    roundEnded: isThai ? `รอบที่ ${String(roundNumber).padStart(2, "0")} สิ้นสุดแล้ว` : `Round ${String(roundNumber).padStart(2, "0")} has ended`,
    roundEndedDescription: isThai
      ? "ปิดการจองแล้ว แอดมินสามารถเริ่มรอบถัดไปได้เมื่อพร้อม"
      : "Reservations are now closed. The admin can start the next round when ready.",
    close: isThai ? "ปิด" : "Close",
  };

  function awardItem(itemId: number, winnerId: string, category: LockCategory) {
    const winnerIgn = ignOf(winnerId);
    const label = itemLabel(itemId);
    setItemList((items) => items.map((item) => (item.id === itemId ? { ...item, status: "claimed", claimedBy: winnerIgn } : item)));
    setReservations((current) => {
      const existing = current.find((reservation) => reservation.member === winnerIgn);
      return existing
        ? current.map((reservation) => (reservation.member === winnerIgn ? { ...reservation, items: [...reservation.items, label] } : reservation))
        : [...current, { member: winnerIgn, items: [label] }];
    });
    setReservationRounds((rounds) => ({ ...rounds, [`${winnerIgn}:${label}`]: roundNumber }));
    // Note: the winner is NOT removed from the real queue here — there is no real backend round behind this page's
    // "locked round" to do that allocation; the real queue only changes when a real queue-ranked round is resolved.
    setCategoryClaims((claims) => {
      const next = { ...claims[category] };
      delete next[winnerId];
      return { ...claims, [category]: next };
    });
  }

  function resolveCategoryRound() {
    const rankings: Record<number, string[]> = {};
    let winners = 0;
    CATEGORY_META.forEach(({ id: category }) => {
      const itemIds = [...new Set(Object.values(categoryClaims[category]))];
      itemIds.forEach((itemId) => {
        const ranked = rankedClaimants(itemId, category);
        rankings[itemId] = ranked;
        if (ranked[0]) {
          awardItem(itemId, ranked[0], category);
          winners += 1;
        }
      });
    });
    setSlotRankings(rankings);
    setRoundResolved(true);
    setRoundEndedNotice(true);
    if (winners) setNotice(isThai ? `สรุปหมวดคิวแล้ว: ${winners} ช่องมีผู้ได้ของ` : `Queue categories resolved: ${winners} slots awarded.`);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving a round is a real transition, not derived state
    if (isAuctionStarted && countdown === null && timeLeft <= 0 && roundMode === "locked" && !roundResolved) resolveCategoryRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuctionStarted, countdown, timeLeft, roundMode, roundResolved]);

  useEffect(() => {
    if (!isAuctionStarted || countdown !== null || timeLeft <= 0) return;
    const timer = window.setInterval(
      () =>
        setTimeLeft((time) => {
          if (time <= 1) {
            setRoundEndedNotice(true);
            return 0;
          }
          return time - 1;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [countdown, isAuctionStarted, timeLeft]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value === null || value <= 1) {
          window.clearInterval(timer);
          setIsAuctionStarted(true);
          setTimeLeft(durationMinutes * 60);
          setNotice("Auction started.");
          return null;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown, durationMinutes]);

  function claimItem(itemId: number) {
    if (!isAuthenticated) {
      setNotice("Sign in with Discord before reserving an item.");
      return;
    }
    const selectedItem = itemList.find((item) => item.id === itemId);
    if (!selectedItem) return;

    if (selectedItem.status === "claimed") {
      if (selectedItem.claimedBy !== myName) return;

      setItemList((currentItems) => currentItems.map((item) => (item.id === itemId ? { ...item, status: "available", claimedBy: undefined } : item)));
      const itemPage = Math.ceil(selectedItem.id / 4);
      const itemPosition = ((selectedItem.id - 1) % 4) + 1;
      const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
      setReservations((currentReservations) =>
        currentReservations
          .map((reservation) => (reservation.member === myName ? { ...reservation, items: reservation.items.filter((item) => item !== reservationLabel) } : reservation))
          .filter((reservation) => reservation.items.length > 0),
      );
      setReservationRounds((rounds) => {
        const nextRounds = { ...rounds };
        delete nextRounds[`${myName}:${reservationLabel}`];
        return nextRounds;
      });
      setNotice(`${reservationLabel} reservation removed.`);
      return;
    }

    const itemPage = Math.ceil(selectedItem.id / 4);
    const itemPosition = ((selectedItem.id - 1) % 4) + 1;
    const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
    const category = categoryOfItem(itemId);
    if (category) {
      toggleCategoryClaim(itemId, category);
      return;
    }

    if (isAuctionClosed) {
      setNotice(!isAuctionStarted ? "The admin has not started this round yet." : "This round has ended.");
      return;
    }

    if (reachedLimit) {
      setNotice(isThai ? `จองได้สูงสุด ${MAX_RESERVATIONS} ชิ้นต่อคน ยกเลิกรายการเดิมก่อนถ้าต้องการเปลี่ยน` : `You can reserve up to ${MAX_RESERVATIONS} items. Remove one to reserve another.`);
      return;
    }

    setItemList((currentItems) => currentItems.map((item) => (item.id === itemId ? { ...item, status: "claimed", claimedBy: myName } : item)));
    setReservations((currentReservations) => {
      const existing = currentReservations.find((reservation) => reservation.member === myName);
      if (existing) return currentReservations.map((reservation) => (reservation.member === myName ? { ...reservation, items: [...reservation.items, reservationLabel] } : reservation));
      return [...currentReservations, { member: myName, items: [reservationLabel] }];
    });
    setReservationRounds((rounds) => ({ ...rounds, [`${myName}:${reservationLabel}`]: roundNumber }));
    setNotice(`${reservationLabel} is reserved for ${myName}.`);
  }

  function copySummary() {
    const auctionDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
    const rounds = [...new Set(reservations.flatMap((reservation) => reservation.items.map((item) => reservationRounds[`${reservation.member}:${item}`] ?? roundNumber)))].sort((a, b) => a - b);
    const summary = rounds
      .flatMap((round) => {
        const roundReservations = reservations
          .map((reservation) => ({
            ...reservation,
            items: reservation.items
              .filter((item) => (reservationRounds[`${reservation.member}:${item}`] ?? roundNumber) === round)
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
          `Clover_TH Auction - Round ${String(round).padStart(2, "0")}`,
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

  /** Starts a round. "normal" opens the untagged pages; "locked" opens the tagged (queue-category) pages instead — same timer either way. */
  function startRound(mode: "normal" | "locked") {
    if (countdown !== null) return;
    setRoundMode(mode);
    setRoundNumber((round) => (round === 0 ? 1 : round + 1));
    if (mode === "locked") {
      setCategoryClaims(emptyClaims());
      setSlotRankings({});
      setRoundResolved(false);
    } else {
      setRoundResolved(true);
    }
    setIsAuctionStarted(false);
    setCountdown(3);
    setNotice(mode === "locked" ? (isThai ? "กำลังเริ่มรอบประมูล item lock..." : "Locked-item round starting...") : "New auction session starting...");
  }

  function openAdminPagePicker() {
    setPendingPageCategories({ ...pageCategories });
    setPickerSelection(new Set());
    setAdminPagePickerGroup(1);
    setAdminPagePickerOpen(true);
  }

  function togglePickerPage(page: number) {
    setPickerSelection((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  // Tick pages first, then assign them a category (or clear them) in one go.
  function assignSelectedPages(category: LockCategory | null) {
    setPendingPageCategories((current) => {
      const next = { ...current };
      pickerSelection.forEach((page) => {
        if (category) next[page] = category;
        else delete next[page];
      });
      return next;
    });
    setPickerSelection(new Set());
  }

  function applyPageCategories() {
    setPageCategories({ ...pendingPageCategories });
    setAdminPagePickerOpen(false);
    const tagged = Object.keys(pendingPageCategories).length;
    setNotice(tagged ? (isThai ? `ติดป้ายหมวดคิว ${tagged} หน้า` : `${tagged} pages tagged for queue categories.`) : isThai ? "ทุกหน้าเป็นการจองปกติ" : "All pages are normal reservations.");
  }

  function toggleCategoryClaim(itemId: number, category: LockCategory) {
    // The item card already redirects to the real queue tab when the member isn't queued (see `goToQueue` in the
    // render below); this is just a defensive fallback in case claimItem() is ever called some other way.
    if (!inQueue(category, memberId)) {
      onGoToQueue();
      return;
    }
    if (!lockedRoundOpen) {
      setNotice(isThai ? "หน้าที่ติดป้ายจะลงชื่อได้เฉพาะตอนแอดมินเปิดรอบประมูล item lock" : "Tagged pages can only be claimed while the admin runs a locked-item round.");
      return;
    }
    const current = categoryClaims[category][memberId];
    const holder = Object.entries(categoryClaims[category]).find(([id, claimed]) => claimed === itemId && id !== memberId)?.[0];
    if (holder) {
      setNotice(isThai ? `${itemLabel(itemId)} มี ${ignOf(holder)} ลงชื่อไว้แล้ว` : `${itemLabel(itemId)} is already claimed by ${ignOf(holder)}.`);
      return;
    }
    setCategoryClaims((claims) => {
      const next = { ...claims[category] };
      if (current === itemId) delete next[memberId];
      else next[memberId] = itemId;
      return { ...claims, [category]: next };
    });
    setNotice(
      current === itemId
        ? isThai
          ? `ยกเลิกการลงชื่อ ${itemLabel(itemId)}`
          : `Removed your claim on ${itemLabel(itemId)}.`
        : current
          ? isThai
            ? `ย้ายการลงชื่อ ${categoryLabel(category)} มาที่ ${itemLabel(itemId)}`
            : `Moved your ${categoryLabel(category)} claim to ${itemLabel(itemId)}.`
          : isThai
            ? `ลงชื่อ ${itemLabel(itemId)} แล้ว — ช่องนี้เป็นของคุณจนปิดรอบ`
            : `Claimed ${itemLabel(itemId)} — this slot is yours until the round ends.`,
    );
  }

  function endRoundNow() {
    if (!isAdmin || !isAuctionStarted || timeLeft <= 0) return;
    setTimeLeft(0);
  }

  // Admin marks a winner who did not buy in game as passed; the slot goes to the next-ranked claimant.
  function declineWinner(itemId: number) {
    const category = categoryOfItem(itemId);
    const item = itemList.find((entry) => entry.id === itemId);
    if (!isAdmin || !category || !item?.claimedBy) return;
    const winnerIgn = item.claimedBy;
    const label = itemLabel(itemId);
    setReservations((current) =>
      current.map((reservation) => (reservation.member === winnerIgn ? { ...reservation, items: reservation.items.filter((entry) => entry !== label) } : reservation)).filter((reservation) => reservation.items.length > 0),
    );
    setItemList((items) => items.map((entry) => (entry.id === itemId ? { ...entry, status: "available", claimedBy: undefined } : entry)));
    const winnerId = guildMembers.find((member) => member.ign === winnerIgn)?.id ?? winnerIgn;
    const remaining = (slotRankings[itemId] ?? []).filter((id) => id !== winnerId);
    setSlotRankings((current) => ({ ...current, [itemId]: remaining }));
    if (remaining[0]) {
      awardItem(itemId, remaining[0], category);
      setNotice(isThai ? `${winnerIgn} สละสิทธิ์ ${label} → โอนให้ ${ignOf(remaining[0])}` : `${winnerIgn} passed on ${label} → awarded to ${ignOf(remaining[0])}.`);
    } else {
      setNotice(isThai ? `${winnerIgn} สละสิทธิ์ ${label} — ไม่มีคนถัดไปในช่องนี้` : `${winnerIgn} passed on ${label} — nobody else claimed it.`);
    }
  }

  return (
    <>
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
            <span>ROUND {roundNumber === 0 ? "--" : String(roundNumber).padStart(2, "0")}</span>
            <strong>{copy.guildAuction}</strong>
            <small>
              {isAuctionClosed ? "Round closed" : `${formattedTime} remaining`}
              {!isAuctionClosed && ` · ${roundMode === "locked" ? (isThai ? "ของล็อก" : "locked items") : isThai ? "ของปกติ" : "normal items"}`}
            </small>
            {isAuthenticated && (
              <em className={`quota ${reachedLimit ? "full" : ""}`}>
                <Package size={11} /> {isThai ? "จองแล้ว" : "Reserved"} {myClaimedCount}/{MAX_RESERVATIONS}
              </em>
            )}
          </div>
        </section>

        <section className={`round-panel ${isAuctionClosed ? "closed" : ""}`}>
          <div className="round-status">
            <span className="timer-icon">{isAuctionClosed ? <Lock size={17} /> : <LockOpen size={17} />}</span>
            <div>
              <strong>
                {!isAuctionStarted
                  ? copy.waiting
                  : timeLeft <= 0
                    ? "Round time is over"
                    : roundMode === "locked"
                      ? isThai
                        ? "เปิดประมูล item lock แล้ว (เฉพาะคนในคิว)"
                        : "Locked-item round is open (queued members only)"
                      : copy.auctionOpen}
              </strong>
              <small>{isAuctionClosed ? "Reservations are paused" : isThai ? "จองก่อนหมดเวลา" : "Reserve before the timer reaches zero"}</small>
            </div>
          </div>
          <div className="timer">
            <span>{copy.timeLeft}</span>
            <strong>{roundNumber === 0 && countdown === null ? "--:--" : formattedTime}</strong>
          </div>
        </section>

        {isAdmin && (
          <section className="admin-panel">
            <div>
              <p className="eyebrow">ADMIN CONTROLS</p>
              <h2>Manage auction round</h2>
              <small>
                {pagesByCategory(pageCategories).some(({ pages }) => pages.length)
                  ? pagesByCategory(pageCategories)
                      .filter(({ pages }) => pages.length)
                      .map(({ category, pages }) => `${categoryLabel(category)}: ${pages.join(", ")}`)
                      .join(" · ")
                  : isThai
                    ? "ยังไม่ได้ติดป้ายหมวดคิว ทุกหน้าเป็นการจองปกติ"
                    : "No queue pages tagged — every page is a normal reservation."}
              </small>
            </div>
            <label>
              <span>{isThai ? "จำนวนหน้า" : "DISPLAY PAGES"}</span>
              <input
                type="number"
                min="1"
                max={MAX_PAGES}
                value={totalPages}
                onChange={(event) => updateTotalPages(Number(event.target.value))}
                title={isThai ? `แสดงหน้าประมูล 1-${MAX_PAGES} หน้า (หน้าละ ${ITEMS_PER_PAGE} ชิ้น)` : `Show 1-${MAX_PAGES} auction pages (${ITEMS_PER_PAGE} items each)`}
              />
            </label>
            <label>
              <span>ROUND MINUTES</span>
              <input type="number" min="1" max="120" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} />
            </label>
            <button type="button" className="admin-button secondary" onClick={openAdminPagePicker}>
              <Tag size={14} /> {isThai ? "ติดป้ายหน้า" : "Tag pages"} ({Object.keys(pageCategories).length})
            </button>
            <button type="button" className="admin-button" disabled={countdown !== null} onClick={() => startRound("normal")}>
              {countdown !== null && roundMode === "normal" ? "Starting..." : "Start round"}
            </button>
            <button
              type="button"
              className="admin-button locked"
              disabled={countdown !== null || !hasTaggedPages}
              title={!hasTaggedPages ? (isThai ? "ติดป้ายหน้าก่อนถึงจะประมูล item lock ได้" : "Tag some pages first") : undefined}
              onClick={() => startRound("locked")}
            >
              <Lock size={13} /> {countdown !== null && roundMode === "locked" ? "Starting..." : isThai ? "ประมูล item lock" : "Auction locked items"}
            </button>
            <button type="button" className="admin-button release" disabled={!isAuctionStarted || countdown !== null || timeLeft <= 0} onClick={endRoundNow}>
              {isThai ? "ปิดรอบ & สรุปผล" : "End round & resolve"}
            </button>
          </section>
        )}

        {adminPagePickerOpen && (
          <div className="page-modal-backdrop" role="presentation" onClick={() => setAdminPagePickerOpen(false)}>
            <section className="page-modal admin-page-modal" role="dialog" aria-modal="true" aria-labelledby="admin-page-picker-title" onClick={(event) => event.stopPropagation()}>
              <div className="page-modal-header">
                <div>
                  <p className="eyebrow">QUEUE PAGES</p>
                  <h2 id="admin-page-picker-title">{isThai ? "ติดป้ายหน้าเป็น Gear / Card / Relic" : "Tag pages as Gear / Card / Relic"}</h2>
                  <small className="event-dialog-status">{isThai ? "1) ติ๊กเลือกหน้า  2) กดหมวดที่ต้องการด้านล่าง  3) กดบันทึก" : "1) Tick pages  2) press a category below  3) Save"}</small>
                </div>
                <button type="button" className="modal-close" onClick={() => setAdminPagePickerOpen(false)}>
                  ×
                </button>
              </div>
              <div className="page-modal-range">
                <button type="button" disabled={adminPagePickerGroup === 1} onClick={() => setAdminPagePickerGroup((group) => group - 1)}>
                  <ArrowLeft size={14} />
                </button>
                <strong>Pages {groupLabel(adminPagePickerGroup)}</strong>
                <button type="button" disabled={adminPagePickerGroup >= groupCount} onClick={() => setAdminPagePickerGroup((group) => group + 1)}>
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="page-modal-grid admin-page-grid">
                {Array.from({ length: groupRange(adminPagePickerGroup).end - groupRange(adminPagePickerGroup).start + 1 }, (_, index) => groupRange(adminPagePickerGroup).start + index).map((page) => (
                  <button
                    type="button"
                    className={`${pendingPageCategories[page] ? `tagged cat-${pendingPageCategories[page]}` : ""} ${pickerSelection.has(page) ? "ticked" : ""}`}
                    key={page}
                    role="checkbox"
                    aria-checked={pickerSelection.has(page)}
                    onClick={() => togglePickerPage(page)}
                  >
                    <span className="tick">{pickerSelection.has(page) ? <Check size={11} /> : null}</span>
                    {page}
                    {pendingPageCategories[page] && <b className="page-tag">{pendingPageCategories[page].toUpperCase()}</b>}
                  </button>
                ))}
              </div>
              <div className="picker-assign">
                <span>
                  {pickerSelection.size > 0
                    ? isThai
                      ? `ตั้ง ${pickerSelection.size} หน้าที่เลือกเป็น:`
                      : `Set ${pickerSelection.size} selected page(s) to:`
                    : isThai
                      ? "ติ๊กหน้าด้านบนก่อน แล้วเลือกหมวด"
                      : "Tick pages above, then pick a category"}
                </span>
                <div className="picker-assign-buttons">
                  {CATEGORY_META.map((category) => (
                    <button type="button" className={`job-swatch cat-${category.id}`} key={category.id} disabled={pickerSelection.size === 0} onClick={() => assignSelectedPages(category.id)}>
                      <Tag size={11} /> {category.label}
                    </button>
                  ))}
                  <button type="button" className="copy-button" disabled={pickerSelection.size === 0} onClick={() => assignSelectedPages(null)}>
                    {isThai ? "ปกติ (ไม่ล็อก)" : "Normal"}
                  </button>
                </div>
              </div>
              <div className="admin-modal-footer">
                <span>
                  {pagesByCategory(pendingPageCategories)
                    .filter(({ pages }) => pages.length)
                    .map(({ category, pages }) => `${category.toUpperCase()} ${pages.join(", ")}`)
                    .join(" · ") || (isThai ? "ยังไม่มีหน้าที่ล็อก" : "No pages tagged")}
                </span>
                <button type="button" className="admin-button" onClick={applyPageCategories}>
                  <Check size={13} /> {isThai ? "บันทึก" : "Save"}
                </button>
              </div>
            </section>
          </div>
        )}

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
          {pageBlocks.map((pageBlock) => {
            const category = pageCategories[pageBlock.page];
            return (
              <section className={`page-block ${category ? `page-queue cat-${category}` : ""}`} key={pageBlock.page} aria-label={`Page ${pageBlock.page}`}>
                <div className="page-label">
                  Page <strong>{pageBlock.page}</strong>
                  {category && (
                    <small className={`cat-badge cat-${category}`}>
                      <Tag size={11} /> {category.toUpperCase()}
                    </small>
                  )}
                </div>
                <div className="item-grid">
                  {pageBlock.items.map((item, itemIndex) => {
                    const isMine = item.status === "claimed" && item.claimedBy === myName;
                    if (category) {
                      const holderId = rankedClaimants(item.id, category)[0];
                      const holder = holderId ? ignOf(holderId) : undefined;
                      const isHolder = holderId === memberId;
                      const myClaim = categoryClaims[category][memberId];
                      const queued = inQueue(category, memberId);
                      const canClaim = isAuthenticated && queued && lockedRoundOpen && item.status !== "claimed" && (!holder || isHolder);
                      const goToQueue = isAuthenticated && !queued && item.status !== "claimed";
                      return (
                        <article className={`item-card queue-slot ${item.status} ${holder ? "held" : ""} ${isHolder ? "mine-claim" : ""}`} key={item.id}>
                          <div className="item-info">
                            <h3>Item {itemIndex + 1}</h3>
                            {item.status === "claimed" ? (
                              <small className="reserved-by">
                                {isThai ? "ได้ของ" : "Won by"} {item.claimedBy}
                              </small>
                            ) : holder ? (
                              <small className={`reserved-by ${isHolder ? "me" : ""}`}>
                                {isThai ? "ลงชื่อโดย" : "Claimed by"} {holder}
                              </small>
                            ) : (
                              <small>{isThai ? "ว่าง — ใครลงชื่อก่อนได้ก่อน" : "Open — first to claim"}</small>
                            )}
                          </div>
                          {item.status === "claimed" && isAdmin && roundResolved ? (
                            <button className="claim-button decline" type="button" onClick={() => declineWinner(item.id)}>
                              <X size={14} /> {isThai ? "สละสิทธิ์ → คนถัดไป" : "Passed → next"}
                            </button>
                          ) : (
                            <button
                              className={`claim-button ${isHolder ? "on-slot" : ""}`}
                              type="button"
                              disabled={goToQueue ? false : !canClaim}
                              title={
                                !queued && isAuthenticated
                                  ? isThai
                                    ? `ยังไม่ได้ลงคิว ${categoryLabel(category)} — ไปลงคิวก่อน`
                                    : `Not queued for ${categoryLabel(category)} yet — join first`
                                  : queued && !lockedRoundOpen
                                    ? isThai
                                      ? "รอแอดมินกดประมูล item lock"
                                      : "Waiting for the admin to run a locked-item round"
                                    : undefined
                              }
                              onClick={() => (goToQueue ? onGoToQueue() : claimItem(item.id))}
                            >
                              {item.status === "claimed" ? (
                                <>{isThai ? "จบรอบแล้ว" : "Resolved"}</>
                              ) : !isAuthenticated ? (
                                <>{copy.reserve}</>
                              ) : !queued ? (
                                <>
                                  <Tag size={14} /> {isThai ? "ไปลงคิว" : "Go queue"}
                                </>
                              ) : !lockedRoundOpen ? (
                                <>
                                  <Lock size={14} /> {isThai ? "ยังไม่เปิดรอบ" : "Round not open"}
                                </>
                              ) : isHolder ? (
                                <>
                                  <Trash2 size={14} /> {copy.cancel}
                                </>
                              ) : holder ? (
                                <>{isThai ? "มีคนลงชื่อแล้ว" : "Taken"}</>
                              ) : myClaim ? (
                                <>
                                  <Package size={14} /> {isThai ? "ย้ายมาช่องนี้" : "Move here"}
                                </>
                              ) : (
                                <>
                                  <Package size={14} /> {isThai ? "ลงชื่อ" : "Claim"}
                                </>
                              )}
                            </button>
                          )}
                        </article>
                      );
                    }
                    return (
                      <article className={`item-card ${item.status}`} key={item.id}>
                        <div className="item-info">
                          <h3>Item {itemIndex + 1}</h3>
                          {item.status === "claimed" && <small className="reserved-by">Reserved by {item.claimedBy}</small>}
                        </div>
                        <button
                          className="claim-button"
                          type="button"
                          disabled={!isAuthenticated || (!normalRoundOpen && !isMine) || (item.status === "claimed" && !isMine) || (reachedLimit && !isMine)}
                          onClick={() => claimItem(item.id)}
                        >
                          {isMine ? (
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
            );
          })}
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
      {countdown !== null && (
        <div className="countdown-backdrop" role="status" aria-live="assertive">
          <div className="countdown-modal">
            <span>ROUND {String(roundNumber).padStart(2, "0")}</span>
            <strong>{countdown}</strong>
            <small>{roundMode === "locked" ? (isThai ? "ประมูล item lock กำลังเริ่ม" : "Locked-item auction starting") : "Auction starting"}</small>
          </div>
        </div>
      )}
      {roundEndedNotice && (
        <div className="round-ended-backdrop" role="alertdialog" aria-modal="true">
          <div className="round-ended-modal">
            <span className="ended-icon">
              <Check size={22} />
            </span>
            <p className="eyebrow">{copy.roundComplete}</p>
            <h2>{copy.roundEnded}</h2>
            <p>{copy.roundEndedDescription}</p>
            <button type="button" className="round-ended-close" onClick={() => setRoundEndedNotice(false)}>
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
