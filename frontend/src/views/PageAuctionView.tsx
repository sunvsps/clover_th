import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ListOrdered, Lock, LockOpen, Package, Tag, Trash2, Users, X } from "lucide-react";
import { emptyClaims, emptyQueues, itemLabel, queueCategories, type BoardMember, type CategoryClaims, type QueueCategory, type QueueLogEntry, type Queues } from "../lib/pageAuction";
import PageQueue from "../components/PageQueue";
import type { ViewProps } from "../lib/types";

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
/** Board state lives in this browser (localStorage) until the backend has an API for page-based rounds. */
const STORE_KEY = "clover.pageAuction.v1";
type Persisted = {
  totalPages: number;
  roundNumber: number;
  pageCategories: Record<number, QueueCategory>;
  categoryClaims: CategoryClaims;
  slotRankings: Record<number, string[]>;
  itemList: Item[];
  reservations: Reservation[];
  reservationRounds: Record<string, number>;
  receivedItems: string[];
  queues: Queues;
  queueLog: QueueLogEntry[];
};
function loadPersisted(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

type Props = ViewProps & { tab: "board" | "queue"; onGoToBoard: () => void };

export default function PageAuctionView({ isThai, me, isAdmin, data, notify, tab, onGoToBoard }: Props) {
  const saved = useMemo(loadPersisted, []);
  const isAuthenticated = true;
  const userName = me.ign;
  const ign = me.ign;
  const members: BoardMember[] = useMemo(() => data.members.map((member) => ({ name: member.ign, job: member.jobId })), [data.members]);
  const jobs = data.jobs;
  const setNotice = notify;
  const [currentPage, setCurrentPage] = useState(1); // page *group* (25 pages each)
  const [totalPages, setTotalPages] = useState(saved.totalPages ?? DEFAULT_PAGES);
  const [roundNumber, setRoundNumber] = useState(saved.roundNumber ?? 0);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [isAuctionStarted, setIsAuctionStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [pageCategories, setPageCategories] = useState<Record<number, QueueCategory>>(saved.pageCategories ?? {});
  const [pendingPageCategories, setPendingPageCategories] = useState<Record<number, QueueCategory>>({});
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
  const [queues, setQueues] = useState<Queues>(() => saved.queues ?? emptyQueues());
  const [queueLog, setQueueLog] = useState<QueueLogEntry[]>(saved.queueLog ?? []);

  useEffect(() => {
    const snapshot: Persisted = { totalPages, roundNumber, pageCategories, categoryClaims, slotRankings, itemList, reservations, reservationRounds, receivedItems: [...receivedItems], queues, queueLog };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  }, [totalPages, roundNumber, pageCategories, categoryClaims, slotRankings, itemList, reservations, reservationRounds, receivedItems, queues, queueLog]);

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
  const myName = me.ign;
  const myClaimedCount = itemList.filter((item) => item.status === "claimed" && item.claimedBy === myName).length;
  const reachedLimit = myClaimedCount >= MAX_RESERVATIONS;
  const pageOf = (itemId: number) => Math.ceil(itemId / 4);
  const categoryOfItem = (itemId: number): QueueCategory | undefined => pageCategories[pageOf(itemId)];
  const inQueue = (category: QueueCategory, member: string) => queues[category].some((entry) => entry.member === member);
  const rankedClaimants = (itemId: number, category: QueueCategory) =>
    Object.entries(categoryClaims[category])
      .filter(([, claimed]) => claimed === itemId)
      .map(([member]) => member)
      .sort((a, b) => queues[category].findIndex((entry) => entry.member === a) - queues[category].findIndex((entry) => entry.member === b));
  const categoryLabel = (category: QueueCategory) => {
    const entry = queueCategories.find((item) => item.id === category);
    return isThai ? entry?.labelTh ?? category : entry?.label ?? category;
  };
  const pagesByCategory = (source: Record<number, QueueCategory>) =>
    queueCategories.map((category) => ({
      category: category.id,
      pages: Object.entries(source)
        .filter(([, value]) => value === category.id)
        .map(([page]) => Number(page))
        .sort((a, b) => a - b),
    }));
  const claimedCount = itemList.filter((item) => item.status === "claimed").length;
  const isAuctionClosed = !isAuctionStarted || countdown !== null || timeLeft <= 0;
  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`;
  const copy = {
    liveBoard: isThai
      ? "กระดานจองไอเท็มแบบเรียลไทม์"
      : "LIVE RESERVATION BOARD",
    guildAuction: isThai ? "ประมูลไอเท็มกิลด์" : "Guild auction",
    waiting: isThai ? "รอแอดมินเริ่มประมูล" : "Waiting for admin to start",
    auctionOpen: isThai ? "เปิดประมูลแล้ว" : "Auction is open",
    timeLeft: isThai ? "เวลาที่เหลือ" : "TIME LEFT",
    dropList: isThai ? "รายการไอเท็ม" : "THE DROP LIST",
    available: isThai ? "ไอเท็มที่เปิดจอง" : "Available items",
    intro: isThai
      ? "ระบบการจองประมูลไอเท็ม Clover_TH Guild"
      : "Reserve your auction drops in a fair, visible queue for",
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
    roundEnded: isThai
      ? `รอบที่ ${String(roundNumber).padStart(2, "0")} สิ้นสุดแล้ว`
      : `Round ${String(roundNumber).padStart(2, "0")} has ended`,
    roundEndedDescription: isThai
      ? "ปิดการจองแล้ว แอดมินสามารถเริ่มรอบถัดไปได้เมื่อพร้อม"
      : "Reservations are now closed. The admin can start the next round when ready.",
    close: isThai ? "ปิด" : "Close",
  };

  useEffect(() => {

    if (isAuctionStarted && countdown === null && timeLeft <= 0 && !roundResolved) resolveCategoryRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuctionStarted, countdown, timeLeft, roundResolved]);

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

      setItemList((currentItems) =>
        currentItems.map((item) =>
          item.id === itemId
            ? { ...item, status: "available", claimedBy: undefined }
            : item,
        ),
      );
      const itemPage = Math.ceil(selectedItem.id / 4);
      const itemPosition = ((selectedItem.id - 1) % 4) + 1;
      const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
      setReservations((currentReservations) =>
        currentReservations
          .map((reservation) =>
            reservation.member === myName
              ? {
                  ...reservation,
                  items: reservation.items.filter(
                    (item) => item !== reservationLabel,
                  ),
                }
              : reservation,
          )
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
      setNotice(
        !isAuctionStarted
          ? "The admin has not started this round yet."
          : "This round has ended.",
      );
      return;
    }

    if (reachedLimit) {
      setNotice(
        isThai
          ? `จองได้สูงสุด ${MAX_RESERVATIONS} ชิ้นต่อคน ยกเลิกรายการเดิมก่อนถ้าต้องการเปลี่ยน`
          : `You can reserve up to ${MAX_RESERVATIONS} items. Remove one to reserve another.`,
      );
      return;
    }

    setItemList((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? { ...item, status: "claimed", claimedBy: myName }
          : item,
      ),
    );
    setReservations((currentReservations) => {
      const existing = currentReservations.find(
        (reservation) => reservation.member === myName,
      );
      if (existing) {
        return currentReservations.map((reservation) =>
          reservation.member === myName
            ? {
                ...reservation,
                items: [...reservation.items, reservationLabel],
              }
            : reservation,
        );
      }
      return [
        ...currentReservations,
        { member: myName, items: [reservationLabel] },
      ];
    });
    setReservationRounds((rounds) => ({
      ...rounds,
      [`${myName}:${reservationLabel}`]: roundNumber,
    }));
    setNotice(`${reservationLabel} is reserved for ${myName}.`);
  }

  function copySummary() {
    const auctionDate = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date());
    const rounds = [
      ...new Set(
        reservations.flatMap((reservation) =>
          reservation.items.map(
            (item) =>
              reservationRounds[`${reservation.member}:${item}`] ?? roundNumber,
          ),
        ),
      ),
    ].sort((a, b) => a - b);
    const summary = rounds
      .flatMap((round) => {
        const roundReservations = reservations
          .map((reservation) => ({
            ...reservation,
            items: reservation.items
              .filter(
                (item) =>
                  (reservationRounds[`${reservation.member}:${item}`] ??
                    roundNumber) === round,
              )
              .sort((firstItem, secondItem) => {
                const firstMatch = firstItem.match(/Page (\d+) \/ Item (\d+)/);
                const secondMatch = secondItem.match(
                  /Page (\d+) \/ Item (\d+)/,
                );
                if (!firstMatch || !secondMatch) return 0;
                return (
                  Number(firstMatch[1]) - Number(secondMatch[1]) ||
                  Number(firstMatch[2]) - Number(secondMatch[2])
                );
              }),
          }))
          .filter((reservation) => reservation.items.length > 0);
        const roundItemCount = roundReservations.reduce(
          (total, reservation) => total + reservation.items.length,
          0,
        );
        return [
          `Clover_TH Auction - Round ${String(round).padStart(2, "0")}`,
          `Auction date: ${auctionDate}`,
          `${roundReservations.length} members · ${roundItemCount} items reserved`,
          "",
          ...roundReservations.flatMap((reservation, index) => [
            `${index + 1}. ${reservation.member}`,
            ...reservation.items.map(
              (item) => `   • ${item.replace(" / ", " — ")}`,
            ),
            "",
          ]),
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

  function startRound() {
    if (countdown !== null) return;
    setRoundNumber((round) => (round === 0 ? 1 : round + 1));
    setCategoryClaims(emptyClaims());
    setSlotRankings({});
    setRoundResolved(false);
    setIsAuctionStarted(false);
    setCountdown(3);
    setNotice("New auction session starting...");
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
  function assignSelectedPages(category: QueueCategory | null) {
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

  function toggleCategoryClaim(itemId: number, category: QueueCategory) {
    if (!inQueue(category, myName)) {
      setNotice(isThai ? `ต้องลงคิว ${categoryLabel(category)} ก่อนถึงจะจองหน้านี้ได้` : `Join the ${categoryLabel(category)} queue before reserving on this page.`);
      return;
    }
    if (isAuctionClosed) {
      setNotice(!isAuctionStarted ? "The admin has not started this round yet." : "This round has ended.");
      return;
    }
    const current = categoryClaims[category][myName];
    const holder = Object.entries(categoryClaims[category]).find(([member, claimed]) => claimed === itemId && member !== myName)?.[0];
    if (holder) {
      setNotice(isThai ? `${itemLabel(itemId)} มี ${holder} ลงชื่อไว้แล้ว` : `${itemLabel(itemId)} is already claimed by ${holder}.`);
      return;
    }
    setCategoryClaims((claims) => {
      const next = { ...claims[category] };
      if (current === itemId) delete next[myName];
      else next[myName] = itemId;
      return { ...claims, [category]: next };
    });
    setNotice(
      current === itemId
        ? isThai ? `ยกเลิกการลงชื่อ ${itemLabel(itemId)}` : `Removed your claim on ${itemLabel(itemId)}.`
        : current
          ? isThai ? `ย้ายการลงชื่อ ${categoryLabel(category)} มาที่ ${itemLabel(itemId)}` : `Moved your ${categoryLabel(category)} claim to ${itemLabel(itemId)}.`
          : isThai ? `ลงชื่อ ${itemLabel(itemId)} แล้ว — ช่องนี้เป็นของคุณจนปิดรอบ` : `Claimed ${itemLabel(itemId)} — this slot is yours until the round ends.`,
    );
  }

  function awardItem(itemId: number, member: string, category: QueueCategory) {
    const label = itemLabel(itemId);
    setItemList((items) => items.map((item) => (item.id === itemId ? { ...item, status: "claimed", claimedBy: member } : item)));
    setReservations((current) => {
      const existing = current.find((reservation) => reservation.member === member);
      return existing
        ? current.map((reservation) => (reservation.member === member ? { ...reservation, items: [...reservation.items, label] } : reservation))
        : [...current, { member, items: [label] }];
    });
    setReservationRounds((rounds) => ({ ...rounds, [`${member}:${label}`]: roundNumber }));
    setQueues((current) => ({ ...current, [category]: current[category].filter((entry) => entry.member !== member) }));
    setQueueLog((current) => [{ id: Date.now() + itemId, time: Date.now(), round: roundNumber, category, itemName: label, member, result: "taken" }, ...current]);
  }

  // Round end: the best-ranked claimant of each tagged slot wins and leaves that queue; everyone else keeps their spot.
  function resolveCategoryRound() {
    const rankings: Record<number, string[]> = {};
    let winners = 0;
    queueCategories.forEach(({ id: category }) => {
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
    setCategoryClaims(emptyClaims());
    setRoundResolved(true);
    setRoundEndedNotice(true);
    if (winners) setNotice(isThai ? `สรุปหมวดคิวแล้ว: ${winners} ช่องมีผู้ได้ของ` : `Queue categories resolved: ${winners} slots awarded.`);
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
    const winner = item.claimedBy;
    const label = itemLabel(itemId);
    setReservations((current) =>
      current
        .map((reservation) => (reservation.member === winner ? { ...reservation, items: reservation.items.filter((entry) => entry !== label) } : reservation))
        .filter((reservation) => reservation.items.length > 0),
    );
    setItemList((items) => items.map((entry) => (entry.id === itemId ? { ...entry, status: "available", claimedBy: undefined } : entry)));
    setQueueLog((current) => [{ id: Date.now(), time: Date.now(), round: roundNumber, category, itemName: label, member: winner, result: "declined" }, ...current]);
    const remaining = (slotRankings[itemId] ?? []).filter((member) => member !== winner);
    setSlotRankings((current) => ({ ...current, [itemId]: remaining }));
    if (remaining[0]) {
      awardItem(itemId, remaining[0], category);
      setNotice(isThai ? `${winner} สละสิทธิ์ ${label} → โอนให้ ${remaining[0]}` : `${winner} passed on ${label} → awarded to ${remaining[0]}.`);
    } else {
      setNotice(isThai ? `${winner} สละสิทธิ์ ${label} — ไม่มีคนถัดไปในช่องนี้` : `${winner} passed on ${label} — nobody else claimed it.`);
    }
  }


  function joinQueue(category: QueueCategory) {
    if (!isAuthenticated || !members.some((member) => member.name === userName)) return;
    setQueues((current) =>
      current[category].some((entry) => entry.member === userName)
        ? current
        : { ...current, [category]: [...current[category], { member: userName, joinedAt: Date.now() }] },
    );
    setNotice(isThai ? `ลงคิว ${category.toUpperCase()} แล้ว` : `Joined the ${category} queue.`);
  }

  function leaveQueue(category: QueueCategory, member: string) {
    if (member !== userName && !isAdmin) return;
    setQueues((current) => ({ ...current, [category]: current[category].filter((entry) => entry.member !== member) }));
    setNotice(isThai ? `${member} ออกจากคิว ${category.toUpperCase()} แล้ว` : `${member} left the ${category} queue.`);
  }


  return (
    <>
      {tab === "board" ? (
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
            <span>
              ROUND{" "}
              {roundNumber === 0 ? "--" : String(roundNumber).padStart(2, "0")}
            </span>
            <strong>{copy.guildAuction}</strong>
            <small>
              {isAuctionClosed ? "Round closed" : `${formattedTime} remaining`}
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
            <span className="timer-icon">
              {isAuctionClosed ? <Lock size={17} /> : <LockOpen size={17} />}
            </span>
            <div>
              <strong>
                {!isAuctionStarted
                  ? copy.waiting
                  : timeLeft <= 0
                    ? "Round time is over"
                    : copy.auctionOpen}
              </strong>
              <small>
                {isAuctionClosed
                  ? "Reservations are paused"
                  : isThai
                    ? "จองก่อนหมดเวลา"
                    : "Reserve before the timer reaches zero"}
              </small>
            </div>
          </div>
          <div className="timer">
            <span>{copy.timeLeft}</span>
            <strong>
              {roundNumber === 0 && countdown === null
                ? "--:--"
                : formattedTime}
            </strong>
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
              <input
                type="number"
                min="1"
                max="120"
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(Number(event.target.value))
                }
              />
            </label>
            <button
              type="button"
              className="admin-button secondary"
              onClick={openAdminPagePicker}
            >
              <Tag size={14} /> {isThai ? "ติดป้ายหน้า" : "Tag pages"} ({Object.keys(pageCategories).length})
            </button>
            <button
              type="button"
              className="admin-button"
              disabled={countdown !== null}
              onClick={startRound}
            >
              {countdown !== null ? "Starting..." : "Start round"}
            </button>
            <button
              type="button"
              className="admin-button release"
              disabled={!isAuctionStarted || countdown !== null || timeLeft <= 0}
              onClick={endRoundNow}
            >
              {isThai ? "ปิดรอบ & สรุปผล" : "End round & resolve"}
            </button>
          </section>
        )}

        {adminPagePickerOpen && (
          <div
            className="page-modal-backdrop"
            role="presentation"
            onClick={() => setAdminPagePickerOpen(false)}
          >
            <section
              className="page-modal admin-page-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-page-picker-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="page-modal-header">
                <div>
                  <p className="eyebrow">QUEUE PAGES</p>
                  <h2 id="admin-page-picker-title">{isThai ? "ติดป้ายหน้าเป็น Gear / Card / Relic" : "Tag pages as Gear / Card / Relic"}</h2>
                  <small className="event-dialog-status">
                    {isThai ? "1) ติ๊กเลือกหน้า  2) กดหมวดที่ต้องการด้านล่าง  3) กดบันทึก" : "1) Tick pages  2) press a category below  3) Save"}
                  </small>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setAdminPagePickerOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="page-modal-range">
                <button
                  type="button"
                  disabled={adminPagePickerGroup === 1}
                  onClick={() => setAdminPagePickerGroup((group) => group - 1)}
                >
                  <ArrowLeft size={14} />
                </button>
                <strong>Pages {groupLabel(adminPagePickerGroup)}</strong>
                <button
                  type="button"
                  disabled={adminPagePickerGroup >= groupCount}
                  onClick={() => setAdminPagePickerGroup((group) => group + 1)}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="page-modal-grid admin-page-grid">
                {Array.from(
                  { length: groupRange(adminPagePickerGroup).end - groupRange(adminPagePickerGroup).start + 1 },
                  (_, index) => groupRange(adminPagePickerGroup).start + index,
                ).map((page) => (
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
                    ? isThai ? `ตั้ง ${pickerSelection.size} หน้าที่เลือกเป็น:` : `Set ${pickerSelection.size} selected page(s) to:`
                    : isThai ? "ติ๊กหน้าด้านบนก่อน แล้วเลือกหมวด" : "Tick pages above, then pick a category"}
                </span>
                <div className="picker-assign-buttons">
                  {queueCategories.map((category) => (
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
                <button
                  type="button"
                  className="admin-button"
                  onClick={applyPageCategories}
                >
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
              <section
                className={`page-block ${category ? `page-queue cat-${category}` : ""}`}
                key={pageBlock.page}
                aria-label={`Page ${pageBlock.page}`}
              >
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
                    const isMine =
                      item.status === "claimed" &&
                      item.claimedBy === myName;
                    if (category) {
                      const holder = rankedClaimants(item.id, category)[0];
                      const isHolder = holder === myName;
                      const myClaim = categoryClaims[category][myName];
                      const queued = inQueue(category, myName);
                      const canClaim = isAuthenticated && queued && !isAuctionClosed && item.status !== "claimed" && (!holder || isHolder);
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
                              disabled={!canClaim}
                              title={!queued && isAuthenticated ? (isThai ? `ต้องลงคิว ${categoryLabel(category)} ก่อน` : `Join the ${categoryLabel(category)} queue first`) : undefined}
                              onClick={() => claimItem(item.id)}
                            >
                              {item.status === "claimed" ? (
                                <>{isThai ? "จบรอบแล้ว" : "Resolved"}</>
                              ) : !isAuthenticated ? (
                                <>{copy.reserve}</>
                              ) : !queued ? (
                                <>
                                  <ListOrdered size={14} /> {isThai ? "ต้องลงคิว" : "Queue first"}
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
                      <article
                        className={`item-card ${item.status}`}
                        key={item.id}
                      >
                        <div className="item-info">
                          <h3>Item {itemIndex + 1}</h3>
                          {item.status === "claimed" && (
                            <small className="reserved-by">
                              Reserved by {item.claimedBy}
                            </small>
                          )}
                        </div>
                        <button
                          className="claim-button"
                          type="button"
                          disabled={
                            !isAuthenticated ||
                            (isAuctionClosed && !isMine) ||
                            (item.status === "claimed" && !isMine) ||
                            (reachedLimit && !isMine)
                          }
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
              const isOwnReservation = reservation.member === ign.trim();
              const sortedItems = [...reservation.items].sort(
                (firstItem, secondItem) => {
                  const firstMatch = firstItem.match(
                    /Page (\d+) \/ Item (\d+)/,
                  );
                  const secondMatch = secondItem.match(
                    /Page (\d+) \/ Item (\d+)/,
                  );
                  if (!firstMatch || !secondMatch) return 0;
                  return (
                    Number(firstMatch[1]) - Number(secondMatch[1]) ||
                    Number(firstMatch[2]) - Number(secondMatch[2])
                  );
                },
              );
              const allReceived = sortedItems.every((item) =>
                receivedItems.has(`${reservation.member}:${item}`),
              );
              return (
                <article className="summary-card" key={reservation.member}>
                  <div className="member-heading">
                    <span className="member-avatar">
                      {reservation.member.charAt(0).toUpperCase()}
                    </span>
                    <strong>{reservation.member}</strong>
                    <span className="item-count">
                      {sortedItems.length}{" "}
                      {sortedItems.length === 1 ? "item" : "items"}
                    </span>
                    {isOwnReservation && (
                      <button
                        type="button"
                        className="receive-all-button"
                        onClick={() =>
                          allReceived
                            ? undoAllReceived(reservation.member, sortedItems)
                            : markAllReceived(reservation.member, sortedItems)
                        }
                      >
                        {allReceived ? copy.undoAll : copy.receivedAll}
                      </button>
                    )}
                  </div>
                  {sortedItems.map((item) => {
                    const isReceived = receivedItems.has(
                      `${reservation.member}:${item}`,
                    );
                    return (
                      <div
                        className={`reserved-item ${isReceived ? "received" : ""}`}
                        key={item}
                      >
                        <span />
                        {item}
                        {isReceived ? (
                          <button
                            type="button"
                            className="undo-received-button"
                            onClick={() =>
                              undoReceived(reservation.member, item)
                            }
                          >
                            {copy.undo}
                          </button>
                        ) : isOwnReservation ? (
                          <button
                            type="button"
                            className="receive-button"
                            onClick={() =>
                              markItemReceived(reservation.member, item)
                            }
                          >
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
      ) : (
        <div className="feature-content">
          <PageQueue
            isThai={isThai}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            userName={userName}
            jobs={jobs}
            members={members}
            queues={queues}
            claims={categoryClaims}
            pages={pagesByCategory(pageCategories)}
            roundOpen={!isAuctionClosed}
            log={queueLog}
            onJoin={joinQueue}
            onLeave={leaveQueue}
            onGoToAuction={onGoToBoard}
          />
        </div>
      )}
      {countdown !== null && (
        <div className="countdown-backdrop" role="status" aria-live="assertive">
          <div className="countdown-modal">
            <span>ROUND {String(roundNumber).padStart(2, "0")}</span>
            <strong>{countdown}</strong>
            <small>Auction starting</small>
          </div>
        </div>
      )}
      {roundEndedNotice && (
        <div
          className="round-ended-backdrop"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="round-ended-modal">
            <span className="ended-icon">
              <Check size={22} />
            </span>
            <p className="eyebrow">{copy.roundComplete}</p>
            <h2>{copy.roundEnded}</h2>
            <p>{copy.roundEndedDescription}</p>
            <button
              type="button"
              className="round-ended-close"
              onClick={() => setRoundEndedNotice(false)}
            >
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
