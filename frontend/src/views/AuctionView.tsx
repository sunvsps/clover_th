import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Gavel, ListOrdered, Lock, LockOpen, LogIn, LogOut, Package, Plus, Trash2, Users, X } from "lucide-react";
import { auctions, serverNow, type QueueCategory, type Round, type RoundItem, type RoundSummary } from "../api";
import { categoryLabel, findJob, jobStyle, queueCategories } from "../data/guild";
import { formatDateTime } from "../lib/dates";
import { usePolling } from "../hooks/usePolling";
import { memberName, type ViewProps } from "../lib/types";

type RoundRow = RoundSummary["rounds"][number];

function useCountdown(closesAt: string | null, opensAt: string | null) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const opens = opensAt ? Date.parse(opensAt) : null;
  const closes = closesAt ? Date.parse(closesAt) : null;
  const untilOpen = opens !== null ? Math.max(0, opens - now) : 0;
  const untilClose = closes !== null ? Math.max(0, closes - now) : 0;
  return { untilOpen, untilClose, isBeforeOpen: untilOpen > 0, isOver: closes !== null && now >= closes };
}
const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function AuctionView({ isThai, me, isAdmin, data, notify, notifyError }: ViewProps) {
  const { data: list, refresh: refreshList } = usePolling(() => auctions.rounds(), 5000, []);
  const rounds = useMemo(() => list?.rounds ?? [], [list]);
  const openRounds = rounds.filter((round) => round.status === "OPEN");
  const closedRounds = rounds.filter((round) => round.status === "CLOSED").slice(0, 8);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const activeId = selectedId ?? openRounds[0]?.id ?? closedRounds[0]?.id ?? null;
  const activeRow = rounds.find((round) => round.id === activeId) ?? null;

  const { data: round, refresh: refreshRound, setData: setRound } = usePolling(activeId !== null ? () => auctions.round(activeId) : null, activeRow?.status === "OPEN" ? 1500 : 8000, [activeId, activeRow?.status]);
  const { data: queues, refresh: refreshQueues } = usePolling(() => auctions.queues(), 5000, []);
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<number[]>([]);
  const [prefsDirty, setPrefsDirty] = useState(false);

  const countdown = useCountdown(round?.closesAt ?? null, round?.opensAt ?? null);
  const isOpen = round?.status === "OPEN" && !countdown.isBeforeOpen && !countdown.isOver;
  const winCap = round?.winCap ?? 5;
  const memberJob = (memberId: string) => findJob(data.jobs, data.membersById.get(memberId)?.jobId);

  useEffect(() => {
    if (!round || round.type !== "QUEUE_RANKED") return;
    let cancelled = false;
    auctions
      .myPreferences(round.id)
      .then((result) => {
        if (!cancelled) {
          setPrefs(result.itemIds);
          setPrefsDirty(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  useEffect(() => {
    if (countdown.isOver && round?.status === "OPEN") {
      const timer = window.setTimeout(() => {
        void refreshRound();
        void refreshList();
      }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [countdown.isOver, round?.status, refreshRound, refreshList]);

  async function claim(item: RoundItem) {
    if (!round || busyItem) return;
    setBusyItem(item.id);
    try {
      const result = item.winner?.memberId === me.memberId ? await auctions.release(round.id, item.id) : await auctions.claim(round.id, item.id);
      setRound((current) => (current ? { ...current, items: current.items.map((entry) => (entry.id === result.item.id ? result.item : entry)), myWinCount: result.myWinCount } : current));
      notify(result.item.winner?.memberId === me.memberId ? (isThai ? `จอง ${item.name} สำเร็จ (${result.myWinCount}/${winCap})` : `Claimed ${item.name} (${result.myWinCount}/${winCap}).`) : isThai ? `ยกเลิก ${item.name} แล้ว` : `Released ${item.name}.`);
    } catch (error) {
      notifyError(error);
      void refreshRound();
    } finally {
      setBusyItem(null);
    }
  }

  async function toggleQueue(category: QueueCategory, joined: boolean) {
    try {
      const result = joined ? await auctions.leaveQueue(category) : await auctions.joinQueue(category);
      notify(joined ? (isThai ? `ออกจากคิว ${categoryLabel(category, isThai)} แล้ว` : `Left the ${categoryLabel(category, isThai)} queue.`) : isThai ? `ลงคิว ${categoryLabel(category, isThai)} แล้ว ลำดับที่ ${result.myRank}` : `Joined the ${categoryLabel(category, isThai)} queue at #${result.myRank}.`);
      await refreshQueues();
    } catch (error) {
      notifyError(error);
    }
  }

  async function savePrefs() {
    if (!round) return;
    try {
      const result = await auctions.savePreferences(round.id, prefs);
      setPrefs(result.itemIds);
      setPrefsDirty(false);
      notify(isThai ? "บันทึกลำดับความต้องการแล้ว" : "Preferences saved.");
    } catch (error) {
      notifyError(error);
    }
  }
  const movePref = (index: number, delta: number) => {
    const next = [...prefs];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPrefs(next);
    setPrefsDirty(true);
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, RoundItem[]>();
    round?.items.forEach((item) => groups.set(item.category, [...(groups.get(item.category) ?? []), item]));
    return [...groups.entries()];
  }, [round]);

  const roundStatusLabel = (row: RoundRow | Round) =>
    row.status === "OPEN" ? (isThai ? "เปิดอยู่" : "Open") : row.status === "CLOSED" ? (isThai ? "ปิดแล้ว" : "Closed") : row.status === "DRAFT" ? (isThai ? "ร่าง" : "Draft") : isThai ? "ยกเลิก" : "Cancelled";
  const typeLabel = (type: Round["type"]) => (type === "LIVE_CLAIM" ? (isThai ? "กดจองสด" : "Live claim") : isThai ? "จัดสรรตามคิว" : "Queue allocation");

  return (
    <section className="feature-page auction-page">
      <section className="intro-row">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> {isThai ? "กระดานประมูลไอเท็ม" : "LIVE AUCTION BOARD"}
          </p>
          <h1>
            {isThai ? "ประมูลไอเท็มกิลด์" : "Guild auction"}
            <span>.</span>
          </h1>
          <p className="intro-copy">
            {isThai
              ? "รอบแบบกดจองสด: ใครกดก่อนได้ก่อน (เวลาเซิร์ฟเวอร์) สูงสุด 5 ชิ้น รอบแบบคิว: ลงคิว Gear/Card/Relic ไว้ก่อน แล้วเรียงลำดับของที่อยากได้ ระบบจัดสรรตามลำดับคิวเมื่อปิดรอบ"
              : "Live-claim rounds: first click wins (server time), up to 5 items. Queue rounds: join the Gear/Card/Relic queues in advance, rank the items you want, and the server allocates by queue order when the round closes."}
          </p>
        </div>
        <div className="season-card">
          <span>{openRounds.length ? (isThai ? "รอบที่เปิดอยู่" : "OPEN ROUNDS") : isThai ? "ไม่มีรอบเปิด" : "NO OPEN ROUND"}</span>
          <strong>{activeRow ? activeRow.name : isThai ? "รอแอดมินเปิดรอบ" : "Waiting for an admin"}</strong>
          <small>{activeRow ? `${typeLabel(activeRow.type)} · ${activeRow.itemCount} ${isThai ? "ชิ้น" : "items"}` : "—"}</small>
          {round?.type === "LIVE_CLAIM" && (
            <em className={`quota ${round.myWinCount >= winCap ? "full" : ""}`}>
              <Package size={11} /> {isThai ? "จองแล้ว" : "Claimed"} {round.myWinCount}/{winCap}
            </em>
          )}
        </div>
      </section>

      {rounds.length > 1 && (
        <div className="round-tabs">
          {[...openRounds, ...closedRounds].map((row) => (
            <button type="button" className={row.id === activeId ? "active" : ""} key={row.id} onClick={() => setSelectedId(row.id)}>
              {row.status === "OPEN" ? <LockOpen size={12} /> : <Lock size={12} />} {row.name} <small>{roundStatusLabel(row)}</small>
            </button>
          ))}
        </div>
      )}

      {round && (
        <section className={`round-panel ${isOpen ? "" : "closed"}`}>
          <div className="round-status">
            <span className="timer-icon">{isOpen ? <LockOpen size={17} /> : <Lock size={17} />}</span>
            <div>
              <strong>
                {round.name} · {typeLabel(round.type)}
              </strong>
              <small>
                {round.status === "OPEN"
                  ? countdown.isBeforeOpen
                    ? isThai ? `เปิดใน ${mmss(countdown.untilOpen)}` : `Opens in ${mmss(countdown.untilOpen)}`
                    : countdown.isOver
                      ? isThai ? "หมดเวลา กำลังสรุปผล…" : "Time is up — finalizing…"
                      : isThai ? "จองก่อนหมดเวลา" : "Reserve before the timer reaches zero"
                  : `${roundStatusLabel(round)}${round.closesAt ? ` · ${formatDateTime(round.closesAt, isThai)}` : ""}`}
              </small>
            </div>
          </div>
          <div className="timer">
            <span>{isThai ? "เวลาที่เหลือ" : "TIME LEFT"}</span>
            <strong>{round.status === "OPEN" ? mmss(countdown.isBeforeOpen ? countdown.untilOpen : countdown.untilClose) : "--:--"}</strong>
          </div>
        </section>
      )}

      {!round && (
        <section className="round-panel closed">
          <div className="round-status">
            <span className="timer-icon">
              <Lock size={17} />
            </span>
            <div>
              <strong>{isThai ? "ยังไม่มีรอบประมูล" : "No auction round yet"}</strong>
              <small>{isThai ? "แอดมินสร้างและเปิดรอบได้จากหน้าตั้งค่าแอดมิน ระหว่างนี้ลงคิวรอไว้ก่อนได้" : "Admins create and start rounds from the admin page. You can join the queues meanwhile."}</small>
            </div>
          </div>
        </section>
      )}

      {round && round.type === "LIVE_CLAIM" && (
        <section className="items-section">
          {grouped.map(([category, items]) => (
            <div className="category-block" key={category}>
              <div className="page-label">
                <strong>{categoryLabel(category, isThai)}</strong>
                <small>{items.length}</small>
              </div>
              <div className="item-grid">
                {items.map((item) => {
                  const isMine = item.winner?.memberId === me.memberId;
                  const taken = !!item.winner && !isMine;
                  return (
                    <article className={`item-card ${item.winner ? "claimed" : ""} ${isMine ? "mine" : ""}`} key={item.id}>
                      <div className="item-info">
                        <h3>{item.name}</h3>
                        {item.rarity && <small className="rarity">{item.rarity}</small>}
                        {item.winner && (
                          <small className="reserved-by">
                            <i className="job-dot" style={jobStyle(memberJob(item.winner.memberId))} /> {isMine ? (isThai ? "ของคุณ" : "Yours") : memberName(data, item.winner.memberId)}
                          </small>
                        )}
                      </div>
                      <button
                        className="claim-button"
                        type="button"
                        disabled={!isOpen || taken || busyItem !== null || (!isMine && round.myWinCount >= winCap)}
                        onClick={() => void claim(item)}
                      >
                        {isMine ? (
                          <>
                            <Trash2 size={14} /> {isThai ? "ยกเลิก" : "Release"}
                          </>
                        ) : taken ? (
                          <>{isThai ? "มีคนจองแล้ว" : "Taken"}</>
                        ) : (
                          <>
                            <Package size={14} /> {isThai ? "จอง" : "Claim"}
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {round && round.type === "QUEUE_RANKED" && (
        <section className="items-section">
          <div className="queue-steps">
            <span>
              <b>1</b> {isThai ? "ต้องอยู่ในคิวหมวดนั้นตอนที่รอบเริ่ม" : "Be in the category queue when the round starts"}
            </span>
            <span>
              <b>2</b> {isThai ? "เลือกของที่อยากได้แล้วเรียงลำดับ" : "Pick the items you want and rank them"}
            </span>
            <span>
              <b>3</b> {isThai ? "ปิดรอบ: คิวต้นได้ของชิ้นแรกที่ยังว่างในลิสต์ของตัวเอง ได้ 1 ชิ้นต่อหมวด แล้วไปต่อท้ายคิว" : "At close: the front of the queue gets the first free item on their list, one per category, then moves to the back"}
            </span>
          </div>
          {round.status === "OPEN" && (
            <p className="occurrence-meta">
              {isThai ? "คุณมีสิทธิ์ในหมวด" : "You are eligible for"}: {round.eligibleCategories.length ? round.eligibleCategories.map((category) => categoryLabel(category, isThai)).join(", ") : isThai ? "— ไม่มี (ไม่ได้อยู่ในคิวตอนเริ่ม)" : "— none (not in a queue at start)"}
            </p>
          )}
          <div className="pref-layout">
            <div>
              {grouped.map(([category, items]) => {
                const eligible = round.eligibleCategories.includes(category);
                return (
                  <div className={`category-block ${eligible ? "" : "ineligible"}`} key={category}>
                    <div className="page-label">
                      <strong>{categoryLabel(category, isThai)}</strong>
                      <small>{eligible ? (isThai ? "มีสิทธิ์" : "eligible") : isThai ? "ไม่มีสิทธิ์" : "not eligible"}</small>
                    </div>
                    <div className="item-grid">
                      {items.map((item) => {
                        const inList = prefs.includes(item.id);
                        return (
                          <article className={`item-card ${item.winner ? "claimed" : ""} ${item.winner?.memberId === me.memberId ? "mine" : ""}`} key={item.id}>
                            <div className="item-info">
                              <h3>{item.name}</h3>
                              {item.rarity && <small className="rarity">{item.rarity}</small>}
                              {item.winner && (
                                <small className="reserved-by">
                                  {isThai ? "ได้ของ" : "Won by"} {memberName(data, item.winner.memberId)} {item.winner.queuePos != null && `(#${item.winner.queuePos})`}
                                </small>
                              )}
                            </div>
                            {round.status === "OPEN" && (
                              <button
                                className={`claim-button ${inList ? "on-slot" : ""}`}
                                type="button"
                                disabled={!eligible || !isOpen}
                                onClick={() => {
                                  setPrefs((current) => (inList ? current.filter((id) => id !== item.id) : [...current, item.id]));
                                  setPrefsDirty(true);
                                }}
                              >
                                {inList ? (
                                  <>
                                    <Check size={14} /> {isThai ? `อยู่ในลิสต์ #${prefs.indexOf(item.id) + 1}` : `Listed #${prefs.indexOf(item.id) + 1}`}
                                  </>
                                ) : (
                                  <>
                                    <Plus size={14} /> {isThai ? "อยากได้" : "Add to list"}
                                  </>
                                )}
                              </button>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {round.status === "OPEN" && (
              <aside className="pref-panel">
                <div className="pool-title">
                  <strong>
                    <ListOrdered size={14} /> {isThai ? "ลำดับที่อยากได้" : "My ranked list"}
                  </strong>
                  <span>{prefs.length}</span>
                </div>
                {prefs.length === 0 && <p className="empty-search">{isThai ? "กด “อยากได้” ที่ไอเท็ม แล้วจัดลำดับที่นี่" : "Add items with “Add to list”, then rank them here."}</p>}
                <ol className="pref-list">
                  {prefs.map((itemId, index) => {
                    const item = round.items.find((entry) => entry.id === itemId);
                    return (
                      <li key={itemId}>
                        <b>{index + 1}</b>
                        <span>
                          {item?.name ?? itemId}
                          <small>{item ? categoryLabel(item.category, isThai) : ""}</small>
                        </span>
                        <button type="button" className="chip-tool" disabled={index === 0} onClick={() => movePref(index, -1)} aria-label="Up">
                          <ArrowUp size={11} />
                        </button>
                        <button type="button" className="chip-tool" disabled={index === prefs.length - 1} onClick={() => movePref(index, 1)} aria-label="Down">
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          className="chip-tool remove"
                          aria-label="Remove"
                          onClick={() => {
                            setPrefs((current) => current.filter((id) => id !== itemId));
                            setPrefsDirty(true);
                          }}
                        >
                          <X size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <button type="button" className="admin-button" disabled={!prefsDirty || !isOpen} onClick={() => void savePrefs()}>
                  <Check size={13} /> {isThai ? "บันทึกลิสต์" : "Save list"}
                </button>
                {prefsDirty && <small className="pref-hint">{isThai ? "ยังไม่ได้บันทึก" : "Unsaved changes"}</small>}
              </aside>
            )}
          </div>
        </section>
      )}

      {round && round.status === "CLOSED" && (
        <section className="summary-section">
          <div className="section-heading summary-heading">
            <div>
              <p className="eyebrow">RESULTS</p>
              <h2>{isThai ? "ผลการประมูล" : "Auction results"}</h2>
            </div>
            <button
              className="copy-button"
              type="button"
              onClick={() => {
                const lines = [`Clover_TH ${round.name}`, ...round.items.filter((item) => item.winner).map((item) => `• ${item.name} — ${memberName(data, item.winner!.memberId)}`)];
                navigator.clipboard?.writeText(lines.join("\n"));
                notify(isThai ? "คัดลอกผลแล้ว" : "Results copied.");
              }}
            >
              <Gavel size={15} /> {isThai ? "คัดลอกผล" : "Copy results"}
            </button>
          </div>
          <div className="summary-meta">
            <span>
              <Users size={15} /> {new Set(round.items.filter((item) => item.winner).map((item) => item.winner!.memberId)).size} {isThai ? "คน" : "members"}
            </span>
            <span>
              <Package size={15} /> {round.items.filter((item) => item.winner).length}/{round.items.length} {isThai ? "ชิ้นมีผู้ได้" : "items awarded"}
            </span>
          </div>
        </section>
      )}

      <section className="queue-section">
        <div className="section-heading summary-heading">
          <div>
            <p className="eyebrow">QUEUES</p>
            <h2>{isThai ? "คิวประมูล Gear / Card / Relic" : "Auction queues"}</h2>
          </div>
        </div>
        <div className="queue-columns">
          {queueCategories.map((category) => {
            const queue = queues?.find((entry) => entry.category === category.id);
            const joined = queue?.myRank != null;
            return (
              <section className="queue-card" key={category.id}>
                <header>
                  <div>
                    <strong>{isThai ? category.labelTh : category.label}</strong>
                    <small>
                      {queue?.length ?? 0} {isThai ? "คนในคิว" : "in queue"}
                    </small>
                  </div>
                  <button type="button" className={joined ? "copy-button danger" : "admin-button"} onClick={() => void toggleQueue(category.id, joined)}>
                    {joined ? <LogOut size={13} /> : <LogIn size={13} />} {joined ? (isThai ? "ออกจากคิว" : "Leave") : isThai ? "ลงคิว" : "Join queue"}
                  </button>
                </header>
                {joined && <p className="my-position">{isThai ? `คุณอยู่ลำดับที่ ${queue?.myRank}` : `You are #${queue?.myRank}`}</p>}
                <ol className="queue-list">
                  {(queue?.entries ?? []).map((entry) => (
                    <li key={entry.memberId} className={entry.memberId === me.memberId ? "mine" : ""}>
                      <i className="job-dot" style={jobStyle(memberJob(entry.memberId))} />
                      <span className="queue-name">{memberName(data, entry.memberId)}</span>
                      <small>{memberJob(entry.memberId)?.label ?? "—"}</small>
                    </li>
                  ))}
                  {(queue?.entries.length ?? 0) === 0 && <li className="empty">{isThai ? "ยังไม่มีใครลงคิว" : "Nobody in this queue yet."}</li>}
                </ol>
              </section>
            );
          })}
        </div>
      </section>
      {isAdmin && <p className="occurrence-meta">{isThai ? "แอดมิน: สร้าง/เปิด/ปิดรอบได้ที่แท็บ “ตั้งค่าแอดมิน” → ประมูล" : "Admins: create, start and close rounds from Admin config → Auctions."}</p>}
    </section>
  );
}
