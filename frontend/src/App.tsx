import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  Hash,
  LogOut,
  Package,
  Lock,
  LockOpen,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./App.css";
import "./features.css";
import { defaultJobs, guildMembers, SUBTEAM_SIZE, type Attendance, type GuildMember, type Job } from "./data/guild";
import WeeklySchedule, { type AttendanceBook } from "./components/WeeklySchedule";
import TeamPlanner, { type TeamAssignments } from "./components/TeamPlanner";

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

const items: Item[] = Array.from({ length: 200 }, (_, index) => {
  const number = index + 1;

  return {
    id: number,
    name: `Item ${String(number).padStart(2, "0")}`,
    rarity: number % 7 === 0 ? "Legendary" : number % 3 === 0 ? "Epic" : "Rare",
    status: "available",
  };
});

const MAX_RESERVATIONS = 5;

type GuildView = "auction" | "calendar" | "teams" | "admin";

function viewFromHash(): GuildView {
  const hash = window.location.hash.replace("#", "");
  return hash === "calendar" || hash === "teams" || hash === "admin" ? hash : "auction";
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState("");
  const [ign, setIgn] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasAdminRole, setHasAdminRole] = useState(false); // granted by the backend role check
  const [isAdmin, setIsAdmin] = useState(false); // currently viewing as admin
  const [roundNumber, setRoundNumber] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [isAuctionStarted, setIsAuctionStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [lockedPages, setLockedPages] = useState<Set<number>>(() => new Set());
  const [heldPagesRound, setHeldPagesRound] = useState(false);
  const [adminPagePickerOpen, setAdminPagePickerOpen] = useState(false);
  const [adminPagePickerGroup, setAdminPagePickerGroup] = useState(1);
  const [pendingLockedPages, setPendingLockedPages] = useState<Set<number>>(
    () => new Set(),
  );
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [adminMembers, setAdminMembers] = useState<string[]>([]);
  const [adminSearch, setAdminSearch] = useState("");
  const [language, setLanguage] = useState<"en" | "th">("en");
  const [itemList, setItemList] = useState(items);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationRounds, setReservationRounds] = useState<
    Record<string, number>
  >({});
  const [receivedItems, setReceivedItems] = useState<Set<string>>(
    () => new Set(),
  );
  const [roundEndedNotice, setRoundEndedNotice] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<GuildView>(() => viewFromHash());
  const [jobs, setJobs] = useState<Job[]>(defaultJobs);
  const [members, setMembers] = useState<GuildMember[]>(guildMembers);
  const [attendance, setAttendance] = useState<AttendanceBook>({});
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignments>({});

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
  const myClaimedCount = itemList.filter((item) => item.status === "claimed" && item.claimedBy === ign.trim()).length;
  const reachedLimit = myClaimedCount >= MAX_RESERVATIONS;
  const claimedCount = itemList.filter(
    (item) => item.status === "claimed",
  ).length;
  const filteredGuildMembers = members.map((member) => member.name).filter((member) =>
    member.toLowerCase().includes(adminSearch.toLowerCase().trim()),
  );
  const isAuctionClosed =
    !isAuctionStarted || countdown !== null || timeLeft <= 0;
  const formattedTime = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`;
  const isThai = language === "th";
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
    if (viewFromHash() !== activeView) {
      window.history.pushState(null, "", activeView === "auction" ? " " : `#${activeView}`);
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView === "admin" && !isAdmin) setActiveView("auction");
  }, [activeView, isAdmin]);

  useEffect(() => {
    const syncView = () => setActiveView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

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

  function signIn() {
    setIsAuthenticated(true);
    setUserName("Mew");
    setIgn("Mew");
    setHasAdminRole(true);
    setIsAdmin(true);
  }

  function claimItem(itemId: number) {
    if (!isAuthenticated) {
      setNotice("Sign in with Discord before reserving an item.");
      return;
    }
    const selectedItem = itemList.find((item) => item.id === itemId);
    if (!selectedItem) return;

    if (selectedItem.status === "claimed") {
      if (selectedItem.claimedBy !== ign.trim()) return;

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
            reservation.member === ign.trim()
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
        delete nextRounds[`${ign.trim()}:${reservationLabel}`];
        return nextRounds;
      });
      setNotice(`${reservationLabel} reservation removed.`);
      return;
    }

    const itemPage = Math.ceil(selectedItem.id / 4);
    const itemPosition = ((selectedItem.id - 1) % 4) + 1;
    const reservationLabel = `Page ${itemPage} / Item ${itemPosition}`;
    const pageIsLocked = heldPagesRound
      ? !lockedPages.has(itemPage)
      : lockedPages.has(itemPage);
    if (pageIsLocked) {
      setNotice(`Page ${itemPage} is locked for this round.`);
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
          ? { ...item, status: "claimed", claimedBy: ign.trim() }
          : item,
      ),
    );
    setReservations((currentReservations) => {
      const existing = currentReservations.find(
        (reservation) => reservation.member === ign.trim(),
      );
      if (existing) {
        return currentReservations.map((reservation) =>
          reservation.member === ign.trim()
            ? {
                ...reservation,
                items: [...reservation.items, reservationLabel],
              }
            : reservation,
        );
      }
      return [
        ...currentReservations,
        { member: ign.trim(), items: [reservationLabel] },
      ];
    });
    setReservationRounds((rounds) => ({
      ...rounds,
      [`${ign.trim()}:${reservationLabel}`]: roundNumber,
    }));
    setNotice(`${reservationLabel} is reserved for ${ign.trim()}.`);
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
    if (member !== ign.trim()) return;
    const key = `${member}:${item}`;
    setReceivedItems((currentItems) => new Set(currentItems).add(key));
    setNotice(`${item} marked as received.`);
  }

  function markAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== ign.trim()) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.add(`${member}:${item}`));
      return nextItems;
    });
    setNotice("All reserved items marked as received.");
  }

  function undoAllReceived(member: string, itemsToReceive: string[]) {
    if (member !== ign.trim()) return;
    setReceivedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      itemsToReceive.forEach((item) => nextItems.delete(`${member}:${item}`));
      return nextItems;
    });
    setNotice("All received marks removed.");
  }

  function undoReceived(member: string, item: string) {
    if (member !== ign.trim()) return;
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
    setHeldPagesRound(false);
    setIsAuctionStarted(false);
    setCountdown(3);
    setNotice("New auction session starting...");
  }

  function openAdminPagePicker() {
    setPendingLockedPages(new Set(lockedPages));
    setAdminPagePickerGroup(1);
    setAdminPagePickerOpen(true);
  }

  function togglePendingPage(page: number) {
    setPendingLockedPages((pages) => {
      const nextPages = new Set(pages);
      if (nextPages.has(page)) nextPages.delete(page);
      else nextPages.add(page);
      return nextPages;
    });
  }

  function applyPageLocks() {
    setLockedPages(new Set(pendingLockedPages));
    setAdminPagePickerOpen(false);
    setNotice(
      pendingLockedPages.size
        ? `Locked pages: ${Array.from(pendingLockedPages)
            .sort((a, b) => a - b)
            .join(", ")}`
        : "All pages unlocked.",
    );
  }

  function releaseHeldPages() {
    if (!isAuctionStarted || timeLeft > 0) {
      setNotice("Finish the current round before releasing held pages.");
      return;
    }
    setHeldPagesRound(true);
    setRoundNumber((round) => (round === 0 ? 1 : round + 1));
    setTimeLeft(durationMinutes * 60);
    setIsAuctionStarted(false);
    setCountdown(3);
    setNotice("Held pages are preparing for the next round.");
  }

  function toggleAdminMember(member: string) {
    setAdminMembers((members) =>
      members.includes(member)
        ? members.filter((currentMember) => currentMember !== member)
        : [...members, member],
    );
  }

  function assignMember(member: string, slot: string) {
    if (teamAssignments[member] === slot) return;
    const occupants = Object.values(teamAssignments).filter((assignedSlot) => assignedSlot === slot).length;
    if (occupants >= SUBTEAM_SIZE) {
      setNotice(isThai ? `ทีมย่อย ${slot.replace("-", "")} เต็มแล้ว (สูงสุด ${SUBTEAM_SIZE} คน)` : `Subteam ${slot.replace("-", "")} is full (max ${SUBTEAM_SIZE}).`);
      return;
    }
    setTeamAssignments((assignments) => ({ ...assignments, [member]: slot }));
  }

  function removeMemberFromTeam(member: string) {
    setTeamAssignments((assignments) => {
      const nextAssignments = { ...assignments };
      delete nextAssignments[member];
      return nextAssignments;
    });
  }

  function clearTeams() {
    setTeamAssignments({});
    setNotice(isThai ? "ล้างการจัดทีมทั้งหมดแล้ว" : "All team assignments cleared.");
  }

  function updateAttendance(key: string, member: string, status: Attendance | null) {
    if (!isAuthenticated) {
      setNotice(isThai ? "กรุณาเข้าสู่ระบบด้วย Discord ก่อนลงทะเบียน" : "Sign in with Discord before registering.");
      return;
    }
    if (member !== userName && !isAdmin) return;
    setAttendance((book) => {
      const entry = { ...(book[key] ?? {}) };
      if (status) entry[member] = status;
      else delete entry[member];
      return { ...book, [key]: entry };
    });
    const who = member === userName ? (isThai ? "คุณ" : "You") : member;
    setNotice(
      status === "joined"
        ? isThai ? `${who} ลงทะเบียนเล่นแล้ว` : `${who} registered as playing.`
        : status === "leave"
          ? isThai ? `บันทึกการลาของ ${who} แล้ว` : `Leave saved for ${who}.`
          : isThai ? `ล้างสถานะของ ${who} แล้ว` : `Status cleared for ${who}.`,
    );
  }

  function addMember(name: string, job: number) {
    if (!isAdmin || !name) return false;
    if (members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
      setNotice(isThai ? `มีชื่อ ${name} อยู่แล้ว` : `${name} is already on the roster.`);
      return false;
    }
    setMembers((current) => [...current, { name, job, custom: true }]);
    setNotice(isThai ? `เพิ่ม ${name} เข้ากิลด์แล้ว` : `${name} added to the roster.`);
    return true;
  }

  function renameMember(oldName: string, newName: string) {
    if (!isAdmin || !newName) return false;
    if (members.some((member) => member.name.toLowerCase() === newName.toLowerCase() && member.name !== oldName)) {
      setNotice(isThai ? `มีชื่อ ${newName} อยู่แล้ว` : `${newName} is already on the roster.`);
      return false;
    }
    setMembers((current) => current.map((member) => (member.name === oldName ? { ...member, name: newName } : member)));
    setTeamAssignments((current) => {
      if (!(oldName in current)) return current;
      const { [oldName]: slot, ...rest } = current;
      return { ...rest, [newName]: slot };
    });
    setAttendance((book) =>
      Object.fromEntries(
        Object.entries(book).map(([key, entry]) => {
          if (!(oldName in entry)) return [key, entry];
          const { [oldName]: status, ...rest } = entry;
          return [key, { ...rest, [newName]: status }];
        }),
      ),
    );
    setAdminMembers((current) => current.map((member) => (member === oldName ? newName : member)));
    setNotice(isThai ? `เปลี่ยนชื่อ ${oldName} เป็น ${newName} แล้ว` : `${oldName} renamed to ${newName}.`);
    return true;
  }

  function setMemberJob(name: string, job: number) {
    if (!isAdmin) return;
    setMembers((current) => current.map((member) => (member.name === name ? { ...member, job } : member)));
    const label = jobs.find((entry) => entry.id === job)?.label ?? job;
    setNotice(isThai ? `เปลี่ยนอาชีพของ ${name} เป็น ${label} แล้ว` : `${name} is now ${label}.`);
  }

  function saveJobs(next: Job[]) {
    if (!isAdmin) return false;
    const removed = jobs.filter((job) => !next.some((entry) => entry.id === job.id));
    const stillUsed = removed.find((job) => members.some((member) => member.job === job.id));
    if (stillUsed) {
      setNotice(isThai ? `ลบ ${stillUsed.label} ไม่ได้ ยังมีสมาชิกใช้อยู่` : `Cannot delete ${stillUsed.label}: still in use.`);
      return false;
    }
    setJobs(next);
    setNotice(isThai ? "บันทึกรายการอาชีพแล้ว" : "Job list saved.");
    return true;
  }

  function removeMember(name: string) {
    if (!isAdmin) return;
    setMembers((current) => current.filter((member) => member.name !== name));
    removeMemberFromTeam(name);
    setAdminMembers((current) => current.filter((member) => member !== name));
    setNotice(isThai ? `ลบ ${name} ออกจากรายชื่อแล้ว` : `${name} removed from the roster.`);
  }

  return (
    <main className={`app-shell ${isThai ? "thai-theme" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Clover TH home">
          <span className="brand-mark">
            <Crown size={17} />
          </span>
          <span>
            <strong>Clover</strong>
            <small>GUILD CONTROL</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="season-label">Ragnarok: The New World</span>
          <div className="profile">
            <button
              className="language-toggle"
              type="button"
              onClick={() =>
                setLanguage((current) => (current === "en" ? "th" : "en"))
              }
              title="Switch language"
            >
              {isThai ? "EN" : "TH"}
            </button>
            {isAuthenticated ? (
              <>
                <span className="avatar">{userName.charAt(0)}</span>
                <span>{userName}</span>
                {isAdmin ? (
                  <div className="role-menu-wrap">
                    <button
                      className="top-admin-badge"
                      type="button"
                      onClick={() => setRoleMenuOpen((open) => !open)}
                    >
                      ADMIN <ChevronDown size={11} />
                    </button>
                    {roleMenuOpen && (
                      <div className="role-menu">
                        <strong>Current role</strong>
                        <span>Administrator</span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveView("admin");
                            setRoleMenuOpen(false);
                          }}
                        >
                          <Settings size={12} /> Admin config
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAdmin(false);
                            setRoleMenuOpen(false);
                            if (activeView === "admin") setActiveView("auction");
                            setNotice("Switched to User view.");
                          }}
                        >
                          Switch to USER view
                        </button>
                      </div>
                    )}
                  </div>
                ) : hasAdminRole ? (
                  <div className="role-menu-wrap">
                    <button className="top-user-badge role-switch" type="button" onClick={() => setRoleMenuOpen((open) => !open)}>
                      USER <ChevronDown size={11} />
                    </button>
                    {roleMenuOpen && (
                      <div className="role-menu">
                        <strong>Current role</strong>
                        <span>User view (admin available)</span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAdmin(true);
                            setRoleMenuOpen(false);
                            setNotice(isThai ? "สลับกลับเป็นมุมมองแอดมินแล้ว" : "Switched back to Admin view.");
                          }}
                        >
                          <Crown size={12} /> Switch to ADMIN view
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="top-user-badge">USER</span>
                )}
                <ChevronDown size={14} />
                <button
                  className="logout-button"
                  type="button"
                  onClick={() => {
                    setIsAuthenticated(false);
                    setIsAdmin(false);
                    setHasAdminRole(false);
                    setRoleMenuOpen(false);
                    if (activeView === "admin") setActiveView("auction");
                  }}
                  title="Sign out"
                >
                  <LogOut size={14} />
                </button>
              </>
            ) : (
              <button
                className="top-login-button"
                type="button"
                onClick={signIn}
              >
                <Hash size={15} /> Sign in with Discord
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="feature-nav" aria-label="Guild tools">
        <button className={activeView === "auction" ? "active" : ""} type="button" onClick={() => setActiveView("auction")}>
          <Package size={15} /> {isThai ? "ประมูลไอเท็ม" : "Auction"}
        </button>
        <button className={activeView === "calendar" ? "active" : ""} type="button" onClick={() => setActiveView("calendar")}>
          <CalendarDays size={15} /> {isThai ? "ตารางกิจกรรม" : "Schedule"}
        </button>
        <button className={activeView === "teams" ? "active" : ""} type="button" onClick={() => setActiveView("teams")}>
          <Users size={15} /> {isThai ? "จัดทีมกิลด์" : "Team planner"}
        </button>
        {isAdmin && (
          <button className={`admin-tab ${activeView === "admin" ? "active" : ""}`} type="button" onClick={() => setActiveView("admin")}>
            <Settings size={15} /> {isThai ? "ตั้งค่าแอดมิน" : "Admin config"}
          </button>
        )}
      </nav>

      <div id="top" className={`content ${activeView !== "auction" ? "hidden-view" : ""}`}>
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
                {heldPagesRound
                  ? "Held-page round: only locked pages are open."
                  : `Round open except locked pages: ${
                      Array.from(lockedPages)
                        .sort((a, b) => a - b)
                        .join(", ") || "none"
                    }`}
              </small>
            </div>
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
              <Lock size={14} /> Select pages ({lockedPages.size})
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
              onClick={releaseHeldPages}
            >
              Release held pages
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
                  <p className="eyebrow">ADMIN PAGE LOCKS</p>
                  <h2 id="admin-page-picker-title">Select pages to lock</h2>
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
                  onClick={() => setAdminPagePickerGroup(1)}
                >
                  <ArrowLeft size={14} />
                </button>
                <strong>
                  {adminPagePickerGroup === 1
                    ? "Pages 1 - 25"
                    : "Pages 26 - 50"}
                </strong>
                <button
                  type="button"
                  disabled={adminPagePickerGroup === 2}
                  onClick={() => setAdminPagePickerGroup(2)}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="page-modal-grid admin-page-grid">
                {Array.from(
                  { length: 25 },
                  (_, index) => (adminPagePickerGroup - 1) * 25 + index + 1,
                ).map((page) => (
                  <button
                    type="button"
                    className={
                      pendingLockedPages.has(page) ? "active locked-choice" : ""
                    }
                    key={page}
                    onClick={() => togglePendingPage(page)}
                  >
                    {pendingLockedPages.has(page) ? (
                      <>
                        <Lock size={12} /> Page {page}
                      </>
                    ) : (
                      `Page ${page}`
                    )}
                  </button>
                ))}
              </div>
              <div className="admin-modal-footer">
                <span>{pendingLockedPages.size} pages selected</span>
                <button
                  type="button"
                  className="admin-button"
                  onClick={applyPageLocks}
                >
                  Apply locks
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
              Pages <strong>{currentPage === 1 ? "1 - 25" : "26 - 50"}</strong>
            </span>
            <button
              className="page-group-button"
              type="button"
              onClick={() => setCurrentPage((page) => (page === 1 ? 2 : 1))}
            >
              {currentPage === 1 ? (
                <>
                  {copy.next} <ArrowRight size={14} />
                </>
              ) : (
                <>
                  <ArrowLeft size={14} /> {copy.previous}
                </>
              )}
            </button>
          </div>
        </section>
        <section className="page-blocks" aria-label="Auction item pages">
          {pageBlocks.map((pageBlock) => {
            const pageIsLocked = heldPagesRound
              ? !lockedPages.has(pageBlock.page)
              : lockedPages.has(pageBlock.page);
            return (
              <section
                className={`page-block ${pageIsLocked ? "page-locked" : ""}`}
                key={pageBlock.page}
                aria-label={`Page ${pageBlock.page}`}
              >
                <div className="page-label">
                  Page <strong>{pageBlock.page}</strong>
                  {pageIsLocked && (
                    <small>
                      <Lock size={11} /> Locked
                    </small>
                  )}
                </div>
                <div className="item-grid">
                  {pageBlock.items.map((item, itemIndex) => {
                    const isMine =
                      item.status === "claimed" &&
                      item.claimedBy === ign.trim();
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
                            pageIsLocked ||
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
            Pages <strong>{currentPage === 1 ? "1 - 25" : "26 - 50"}</strong>
          </span>
          <button
            className="page-group-button"
            type="button"
            onClick={() => setCurrentPage((page) => (page === 1 ? 2 : 1))}
          >
            {currentPage === 1 ? (
              <>
                Next <ArrowRight size={14} />
              </>
            ) : (
              <>
                <ArrowLeft size={14} /> Previous
              </>
            )}
          </button>
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
        <footer>
          <span>CLOVER_TH</span>
          <span>
            Built for fair drops · <CircleHelp size={13} /> Need help?
          </span>
        </footer>
      </div>

      {activeView === "admin" && isAdmin && (
        <div className="feature-content">
          <section className="feature-page admin-config-page">
            <div className="config-header">
              <div>
                <p className="eyebrow">
                  <Settings size={12} /> ADMIN MENU / CONFIG
                </p>
                <h2>{isThai ? "จัดการผู้ดูแล" : "Manage administrators"}</h2>
                <p>
                  {isThai
                    ? "เลือกสมาชิกกิลด์ที่มีสิทธิ์จัดการรอบประมูล ล็อกหน้า ตารางกิจกรรม การจัดทีม และรายชื่ออาชีพ"
                    : "Choose which guild members can manage auction rounds, page locks, the schedule, team plans and the job list."}
                </p>
              </div>
              <button className="config-close" type="button" onClick={() => setActiveView("auction")}>
                {copy.close}
              </button>
            </div>
            <div className="admin-current">
              <span className="eyebrow">{isThai ? "ผู้ดูแลปัจจุบัน" : "CURRENT ADMINS"}</span>
              <div className="roster-people">
                <span className="person joined">
                  <Crown size={10} /> {userName} ({isThai ? "คุณ" : "you"})
                </span>
                {adminMembers.map((member) => (
                  <span className="person joined" key={member}>
                    {member}
                    <button type="button" onClick={() => toggleAdminMember(member)} aria-label={isThai ? "ถอดสิทธิ์" : "Remove admin"}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {adminMembers.length === 0 && <span className="empty-search">{isThai ? "ยังไม่ได้เพิ่มผู้ดูแลคนอื่น" : "No other admins yet."}</span>}
              </div>
            </div>
            <label className="admin-search">
              <span>{isThai ? "ค้นหาสมาชิก" : "SEARCH MEMBERS"}</span>
              <input
                type="search"
                placeholder={isThai ? "ค้นหาด้วยชื่อ..." : "Search by name..."}
                value={adminSearch}
                onChange={(event) => setAdminSearch(event.target.value)}
              />
            </label>
            <div className="member-admin-list">
              {filteredGuildMembers.map((member) => (
                <label className="member-admin-row" key={member}>
                  <span className="member-avatar">{member.charAt(0)}</span>
                  <span>
                    <strong>{member}</strong>
                    <small>{isThai ? "สมาชิกกิลด์" : "Discord guild member"}</small>
                  </span>
                  <input type="checkbox" checked={adminMembers.includes(member)} onChange={() => toggleAdminMember(member)} />
                </label>
              ))}
              {filteredGuildMembers.length === 0 && <p className="empty-search">{isThai ? "ไม่พบสมาชิก" : "No guild members found."}</p>}
            </div>
            <div className="config-footer">
              <span>
                {adminMembers.length} {isThai ? "ผู้ดูแลที่เลือก" : `admin${adminMembers.length === 1 ? "" : "s"} selected`}
              </span>
              <button
                className="admin-button"
                type="button"
                onClick={() => {
                  setNotice(isThai ? "บันทึกการตั้งค่าผู้ดูแลแล้ว" : "Admin configuration saved.");
                  setActiveView("auction");
                }}
              >
                {isThai ? "บันทึกการตั้งค่า" : "Save configuration"}
              </button>
            </div>
          </section>
        </div>
      )}
      {activeView === "calendar" && (
        <div className="feature-content">
          <WeeklySchedule
            isThai={isThai}
            userName={userName || "Guest"}
            isAdmin={isAdmin}
            jobs={jobs}
            members={members}
            attendance={attendance}
            onSetAttendance={updateAttendance}
            onNotice={setNotice}
          />
        </div>
      )}
      {activeView === "teams" && (
        <div className="feature-content wide">
          <TeamPlanner
            isThai={isThai}
            isAdmin={isAdmin}
            jobs={jobs}
            members={members}
            assignments={teamAssignments}
            onAssign={assignMember}
            onRemove={removeMemberFromTeam}
            onClear={clearTeams}
            onAddMember={addMember}
            onRenameMember={renameMember}
            onSetMemberJob={setMemberJob}
            onRemoveMember={removeMember}
            onSaveJobs={saveJobs}
            onNotice={setNotice}
          />
        </div>
      )}

      {notice && (
        <div className="toast">
          <Check size={16} /> {notice}
          <button type="button" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
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
    </main>
  );
}

export default App;
