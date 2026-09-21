import { useEffect, useMemo, useState } from "react";
import { items, type Reservation } from "../data/auction";

type Options = {
  isAuthenticated: boolean;
  ign: string;
  notify: (message: string) => void;
};

/**
 * All state and actions of the item reservation board (local demo behaviour, unchanged by the WP11a extraction):
 * item list, reservations, round timer and start countdown, page locks, "received" marks and the copy-summary text.
 */
export function useAuction({ isAuthenticated, ign, notify }: Options) {
  const [currentPage, setCurrentPage] = useState(1);
  const [roundNumber, setRoundNumber] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [isAuctionStarted, setIsAuctionStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [lockedPages, setLockedPages] = useState<Set<number>>(() => new Set());
  const [heldPagesRound, setHeldPagesRound] = useState(false);
  const [itemList, setItemList] = useState(items);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationRounds, setReservationRounds] = useState<Record<string, number>>({});
  const [receivedItems, setReceivedItems] = useState<Set<string>>(() => new Set());
  const [roundEndedNotice, setRoundEndedNotice] = useState(false);

  const visibleItems = useMemo(
    () => itemList.slice((currentPage - 1) * 100, currentPage * 100),
    [currentPage, itemList],
  );
  const pageBlocks = useMemo(
    () =>
      Array.from({ length: 25 }, (_, index) => ({
        page: (currentPage - 1) * 25 + index + 1,
        items: visibleItems.slice(index * 4, index * 4 + 4),
      })),
    [currentPage, visibleItems],
  );
  const claimedCount = itemList.filter((item) => item.status === "claimed").length;
  const isAuctionClosed = !isAuctionStarted || countdown !== null || timeLeft <= 0;
  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`;

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
          notify("Auction started.");
          return null;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same dependencies as the original component (notify is stable in effect)
  }, [countdown, durationMinutes]);

  function claimItem(itemId: number) {
    if (!isAuthenticated) {
      notify("Sign in with Discord before reserving an item.");
      return;
    }
    const selectedItem = itemList.find((item) => item.id === itemId);
    if (!selectedItem) return;

    if (selectedItem.status === "claimed") {
      if (selectedItem.claimedBy !== ign.trim()) return;

      setItemList((currentItems) =>
        currentItems.map((item) =>
          item.id === itemId ? { ...item, status: "available", claimedBy: undefined } : item,
        ),
      );
      const itemPage = Math.ceil(selectedItem.id / 4);
      const itemPosition = ((selectedItem.id - 1) % 4) + 1;
      const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
      setReservations((currentReservations) =>
        currentReservations
          .map((reservation) =>
            reservation.member === ign.trim()
              ? {
                  ...reservation,
                  items: reservation.items.filter((item) => item !== reservationLabel),
                }
              : reservation,
          )
          .filter((reservation) => reservation.items.length > 0),
      );
      setReservationRounds((rounds) => {
        const nextRounds = { ...rounds };
        delete nextRounds[`${ign.trim()}:${reservationLabel}`];
        return nextRounds;
      });
      notify(`${reservationLabel} reservation removed.`);
      return;
    }

    const itemPage = Math.ceil(selectedItem.id / 4);
    const itemPosition = ((selectedItem.id - 1) % 4) + 1;
    const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
    const pageIsLocked = heldPagesRound ? !lockedPages.has(itemPage) : lockedPages.has(itemPage);
    if (pageIsLocked) {
      notify(`Page ${itemPage} is locked for this round.`);
      return;
    }

    if (isAuctionClosed) {
      notify(!isAuctionStarted ? "The admin has not started this round yet." : "This round has ended.");
      return;
    }

    setItemList((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId ? { ...item, status: "claimed", claimedBy: ign.trim() } : item,
      ),
    );
    setReservations((currentReservations) => {
      const existing = currentReservations.find((reservation) => reservation.member === ign.trim());
      if (existing) {
        return currentReservations.map((reservation) =>
          reservation.member === ign.trim()
            ? { ...reservation, items: [...reservation.items, reservationLabel] }
            : reservation,
        );
      }
      return [...currentReservations, { member: ign.trim(), items: [reservationLabel] }];
    });
    setReservationRounds((rounds) => ({
      ...rounds,
      [`${ign.trim()}:${reservationLabel}`]: roundNumber,
    }));
    notify(`${reservationLabel} is reserved for ${ign.trim()}.`);
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
            (item) => reservationRounds[`${reservation.member}:${item}`] ?? roundNumber,
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
                (item) => (reservationRounds[`${reservation.member}:${item}`] ?? roundNumber) === round,
              )
              .sort((firstItem, secondItem) => {
                const firstMatch = firstItem.match(/Page (\d+) \/ Item (\d+)/);
                const secondMatch = secondItem.match(/Page (\d+) \/ Item (\d+)/);
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
            ...reservation.items.map((item) => `   • ${item.replace(" / ", " — ")}`),
            "",
          ]),
        ];
      })
      .join("\n")
      .trim();
    navigator.clipboard?.writeText(summary);
    notify("Readable reservation summary copied to clipboard.");
  }

  function markItemReceived(member: string, item: string) {
    if (member !== ign.trim()) return;
    const key = `${member}:${item}`;
    setReceivedItems((currentItems) => new Set(currentItems).add(key));
    notify(`${item} marked as received.`);
  }

  function markAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== ign.trim()) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.add(`${member}:${item}`));
      return nextItems;
    });
    notify("All reserved items marked as received.");
  }

  function undoAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== ign.trim()) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.delete(`${member}:${item}`));
      return nextItems;
    });
    notify("All received marks removed.");
  }

  function undoReceived(member: string, item: string) {
    if (member !== ign.trim()) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      nextItems.delete(`${member}:${item}`);
      return nextItems;
    });
    notify(`${item} returned to pending.`);
  }

  function startRound() {
    if (countdown !== null) return;
    setRoundNumber((round) => (round === 0 ? 1 : round + 1));
    setHeldPagesRound(false);
    setIsAuctionStarted(false);
    setCountdown(3);
    notify("New auction session starting...");
  }

  function releaseHeldPages() {
    if (!isAuctionStarted || timeLeft > 0) {
      notify("Finish the current round before releasing held pages.");
      return;
    }
    setHeldPagesRound(true);
    setRoundNumber((round) => (round === 0 ? 1 : round + 1));
    setTimeLeft(durationMinutes * 60);
    setIsAuctionStarted(false);
    setCountdown(3);
    notify("Held pages are preparing for the next round.");
  }

  return {
    // state
    currentPage,
    setCurrentPage,
    roundNumber,
    timeLeft,
    isAuctionStarted,
    countdown,
    durationMinutes,
    setDurationMinutes,
    lockedPages,
    setLockedPages,
    heldPagesRound,
    reservations,
    receivedItems,
    roundEndedNotice,
    dismissRoundEnded: () => setRoundEndedNotice(false),
    // derived
    pageBlocks,
    claimedCount,
    isAuctionClosed,
    formattedTime,
    // actions
    claimItem,
    copySummary,
    markItemReceived,
    markAllReceived,
    undoAllReceived,
    undoReceived,
    startRound,
    releaseHeldPages,
  };
}

export type AuctionState = ReturnType<typeof useAuction>;
