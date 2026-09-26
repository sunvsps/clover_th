import { useState } from "react";
import { ArrowRight, History, ListOrdered, LogIn, LogOut, Package, X } from "lucide-react";
import { getQueueHistory, getQueues, joinQueue, leaveQueue, listRounds, QUEUE_CATEGORIES, removeFromQueue, usePolling, type Category } from "../api";
import { findJob, jobStyle, type GuildMember, type Job } from "../data/guild";
import { useRound } from "../hooks/useRound";
import { auctionErrorText, categoryLabel } from "./auction/auctionModel";

type Props = {
  isThai: boolean;
  isAdmin: boolean;
  memberId: string;
  members: GuildMember[];
  jobs: Job[];
  notify: (message: string) => void;
  onGoToAuction: () => void;
};

const formatTime = (iso: string, isThai: boolean) =>
  new Date(iso).toLocaleString(isThai ? "th-TH" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/**
 * The auction queue page: the persistent Gear / Card / Relic queues (join, leave, admins remove), whether a ranked
 * queue round is open right now, and the history of queue wins. The rules are the server's: a queue round only counts
 * members who were in line when it opened, allocates one item per category by queue order, and moves winners to the back.
 */
export default function QueueView({ isThai, isAdmin, memberId, members, jobs, notify, onGoToAuction }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const byId = new Map(members.map((m) => [m.id, m]));
  const ignOf = (id: string) => byId.get(id)?.ign ?? t("Former member", "อดีตสมาชิก");
  const jobOf = (id: string) => {
    const member = byId.get(id);
    return member ? findJob(jobs, member.job) : undefined;
  };
  const me = byId.get(memberId);

  const polled = usePolling(() => getQueues(), { intervalMs: 5000, key: "queues" });
  const history = usePolling(() => getQueueHistory(40), { intervalMs: 30_000, key: "queue-history" });
  const rounds = usePolling(listRounds, { intervalMs: 10_000, key: "queue-rounds" });
  const openRound = (rounds.data ?? []).find((r) => r.type === "queueRanked" && r.status === "open") ?? null;
  const { round } = useRound(openRound?.id ?? null, openRound !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const queues = polled.data ?? [];

  const inRound = (category: Category) => (round && round.id === openRound?.id ? round.items.filter((i) => i.category === category).length : 0);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      notify(done);
    } catch (err) {
      notify(auctionErrorText(err, isThai, ignOf));
    } finally {
      setBusy(null);
      polled.refresh();
    }
  }

  const join = (category: Category) =>
    run(category, () => joinQueue(category), t(`You joined the ${categoryLabel(category, false)} queue.`, `คุณลงคิว ${categoryLabel(category, true)} แล้ว`));
  const leave = (category: Category) =>
    run(category, () => leaveQueue(category), t(`You left the ${categoryLabel(category, false)} queue.`, `คุณออกจากคิว ${categoryLabel(category, true)} แล้ว`));
  const remove = (category: Category, id: string) =>
    run(`${category}:${id}`, () => removeFromQueue(category, id), t(`${ignOf(id)} was removed from the ${categoryLabel(category, false)} queue.`, `เอา ${ignOf(id)} ออกจากคิว ${categoryLabel(category, true)} แล้ว`));

  return (
    <section className="feature-page queue-page" data-testid="queue-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <ListOrdered size={13} /> AUCTION QUEUE
          </p>
          <h2>{t("Auction queue", "จองคิวประมูล")}</h2>
          <p>
            {t(
              "Queue up ahead of time for Gear / Card / Relic (all three if you like). A ranked queue round only counts members who were in line when it opened. When it closes, items are handed out one per category in queue order, and each winner is taken out of that queue (join again for another).",
              "ลงคิวไว้ล่วงหน้าสำหรับหมวด Gear / Card / Relic (ลงได้ทั้ง 3 คิว) รอบจัดอันดับคิวจะนับเฉพาะคนที่อยู่ในคิวตอนเปิดรอบ เมื่อปิดรอบ ระบบแจกของหมวดละ 1 ชิ้นตามลำดับคิว คนที่ได้ของจะถูกเอาออกจากคิวของหมวดนั้น (อยากได้อีกต้องลงคิวใหม่)",
            )}
          </p>
        </div>
        {me && (
          <div className="schedule-stats">
            <span>
              <i className="job-dot" style={jobStyle(jobOf(me.id))} /> {me.ign}
              <strong>{jobOf(me.id)?.label ?? "—"}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="queue-steps">
        <span>
          <b>1</b> {t("Join the queues you want", "ลงคิวหมวดที่ต้องการ")}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>2</b> {t("Admin opens a ranked queue round", "แอดมินเปิดรอบจัดอันดับคิว")}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>3</b> {t("Rank the items you want", "จัดอันดับไอเท็มที่อยากได้")}
        </span>
        <ArrowRight size={13} />
        <span>
          <b>4</b> {t("Round ends: one item per category by queue order, winners leave that queue", "ปิดรอบ: แจกหมวดละ 1 ชิ้นตามลำดับคิว คนที่ได้ของออกจากคิวหมวดนั้น")}
        </span>
      </div>

      <div className="queue-columns">
        {QUEUE_CATEGORIES.map((category) => {
          const q = queues.find((x) => x.category === category);
          const entries = q?.entries ?? [];
          const live = inRound(category);
          const eligible = round?.eligibleCategories.includes(category) ?? false;
          return (
            <section className={`queue-card ${live ? "live" : ""}`} key={category} data-queue={category}>
              <header>
                <div>
                  <strong>{categoryLabel(category, isThai)}</strong>
                  <small>
                    {q?.length ?? 0} {t("in queue", "คนในคิว")}
                    {live > 0 && (
                      <em>
                        {" · "}
                        <Package size={10} /> {t(`${live} in the open round`, `${live} ชิ้นในรอบที่เปิดอยู่`)}
                      </em>
                    )}
                  </small>
                </div>
                {q?.myRank ? (
                  <button type="button" className="copy-button danger" disabled={busy === category} onClick={() => void leave(category)}>
                    <LogOut size={13} /> {t("Leave", "ออกจากคิว")}
                  </button>
                ) : (
                  <button type="button" className="admin-button" disabled={busy === category || !q} onClick={() => void join(category)}>
                    <LogIn size={13} /> {t("Join queue", "ลงคิว")}
                  </button>
                )}
              </header>
              {q?.myRank ? (
                <p className="my-position">
                  {t(`You are #${q.myRank}`, `คุณอยู่ลำดับที่ ${q.myRank}`)}
                  {live > 0 &&
                    (eligible ? (
                      <button type="button" className="link-button" onClick={onGoToAuction}>
                        {t("Round open: rank your items", "รอบเปิดอยู่ ไปจัดอันดับไอเท็ม")} <ArrowRight size={11} />
                      </button>
                    ) : (
                      <small>{t("You joined after this round opened: you count from the next one.", "คุณลงคิวหลังเปิดรอบนี้ จะมีสิทธิ์ในรอบถัดไป")}</small>
                    ))}
                </p>
              ) : null}
              <ol className="queue-list">
                {entries.map((entry) => (
                  <li key={entry.memberId} className={entry.memberId === memberId ? "mine" : ""}>
                    <i className="job-dot" style={jobStyle(jobOf(entry.memberId))} />
                    <span className="queue-name">{ignOf(entry.memberId)}</span>
                    <small>{jobOf(entry.memberId)?.label ?? "—"}</small>
                    {isAdmin && (
                      <button
                        type="button"
                        className="chip-tool remove"
                        title={t("Remove from queue", "เอาออกจากคิว")}
                        aria-label={t(`Remove ${ignOf(entry.memberId)}`, `เอา ${ignOf(entry.memberId)} ออก`)}
                        disabled={busy === `${category}:${entry.memberId}`}
                        onClick={() => void remove(category, entry.memberId)}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </li>
                ))}
                {entries.length === 0 && <li className="empty">{t("Nobody in this queue yet.", "ยังไม่มีใครลงคิว")}</li>}
              </ol>
            </section>
          );
        })}
      </div>

      <section className="queue-history" data-testid="queue-history">
        <div className="pool-title">
          <strong>
            <History size={14} /> {t("Queue auction history", "ประวัติผลประมูลหมวดคิว")}
          </strong>
          <span>{history.data?.length ?? 0}</span>
        </div>
        {!history.data || history.data.length === 0 ? (
          <p className="empty-search">{t("Nothing yet: filled in automatically when a queue round closes.", "ยังไม่มีรายการ จะบันทึกอัตโนมัติเมื่อปิดรอบจัดอันดับคิว")}</p>
        ) : (
          <ul className="history-list">
            {history.data.map((win) => (
              <li key={win.itemId} className={win.memberId === memberId ? "mine" : ""}>
                <span className="history-time">
                  R{String(win.roundId).padStart(2, "0")} · {formatTime(win.wonAt, isThai)}
                </span>
                <span className="history-item">
                  <strong>{win.itemName}</strong>
                  <small>
                    {categoryLabel(win.category, isThai)} · {win.roundName}
                  </small>
                </span>
                <span className="history-member">
                  {ignOf(win.memberId)}
                  {win.queuePos !== null && <small> #{win.queuePos}</small>}
                </span>
                <span className="history-result taken">{t("Won", "ได้ของ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
