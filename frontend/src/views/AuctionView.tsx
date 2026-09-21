import { useState } from "react";
import { Lock, LockOpen, Package } from "lucide-react";
import { listRounds, usePolling, type RoundListEntry } from "../api";
import type { GuildMember } from "../data/guild";
import { useRound } from "../hooks/useRound";
import { useServerNow } from "../hooks/useServerNow";
import LiveClaimBoard from "./auction/LiveClaimBoard";
import QueueRoundBoard from "./auction/QueueRoundBoard";
import QueuesPanel from "./auction/QueuesPanel";
import RoundResults from "./auction/RoundResults";
import { formatClock, phaseOf, secondsUntil } from "./auction/auctionModel";

type Props = {
  /** false = the page is hidden (another tool is active): it stays mounted (keeps an unsaved ranking) but stops polling */
  visible: boolean;
  isThai: boolean;
  isAdmin: boolean;
  memberId: string;
  members: GuildMember[];
  notify: (message: string) => void;
};

const defaultRound = (rounds: RoundListEntry[]) =>
  rounds.find((r) => r.status === "open") ?? rounds.find((r) => r.status === "closed") ?? rounds[0] ?? null;

/** The auction page: round picker, the selected round (live claim, ranked queue, or results) and the queues. */
export default function AuctionView({ visible, isThai, isAdmin, memberId, members, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [tab, setTab] = useState<"rounds" | "queues">("rounds");
  const [picked, setPicked] = useState<number | null>(null);
  const byId = new Map(members.map((m) => [m.id, m.ign]));
  const ignOf = (id: string) => byId.get(id) ?? (isThai ? "อดีตสมาชิก" : "Former member");

  const list = usePolling(listRounds, { intervalMs: 6000, enabled: visible, key: "rounds" });
  const rounds = list.data ?? [];
  const roundId = picked ?? defaultRound(rounds)?.id ?? null;
  const { round, refresh, apply, error } = useRound(roundId, visible && tab === "rounds");
  const now = useServerNow(250, visible);
  const phase = round ? phaseOf(round, now) : null;
  const startsIn = round && phase === "starting" ? secondsUntil(round.opensAt, now) : 0;
  const timeLeft = round && phase === "open" ? secondsUntil(round.closesAt, now) : 0;
  const isOpenNow = phase === "open";

  const phaseText: Record<string, string> = {
    draft: t("Draft (admins only)", "ฉบับร่าง (เฉพาะแอดมิน)"),
    starting: t("Starting soon", "กำลังจะเริ่ม"),
    open: t("Open", "เปิดอยู่"),
    ended: t("Time is up: closing…", "หมดเวลา: กำลังปิดรอบ…"),
    closed: t("Closed", "ปิดแล้ว"),
    cancelled: t("Cancelled", "ยกเลิกแล้ว"),
  };

  return (
    <div id="top" className={`content ${!visible ? "hidden-view" : ""}`}>
      <section className="intro-row">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> {t("LIVE AUCTION BOARD", "กระดานประมูลสด")}
          </p>
          <h1>
            {t("Guild item auction", "ประมูลไอเท็มกิลด์")}
            <span>.</span>
          </h1>
        </div>
        <div className="season-card">
          <span>{round ? (round.type === "liveClaim" ? "LIVE CLAIM" : "RANKED QUEUE") : "--"}</span>
          <strong>{round?.name ?? t("No round yet", "ยังไม่มีรอบ")}</strong>
          <small>{isOpenNow ? t(`${formatClock(timeLeft)} remaining`, `เหลือ ${formatClock(timeLeft)}`) : phase ? phaseText[phase] : ""}</small>
        </div>
      </section>

      <div className="auction-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "rounds"} className={tab === "rounds" ? "active" : ""} onClick={() => setTab("rounds")}>
          <Package size={14} /> {t("Rounds", "รอบประมูล")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "queues"} className={tab === "queues" ? "active" : ""} onClick={() => setTab("queues")}>
          {t("Queues", "คิว")}
        </button>
      </div>

      {tab === "queues" ? (
        <QueuesPanel isThai={isThai} enabled={visible} ignOf={ignOf} notify={notify} />
      ) : (
        <>
          {rounds.length > 0 && (
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

          {list.error && <p className="schedule-error" role="alert">{list.error.userMessage(isThai)}</p>}
          {error && <p className="schedule-error" role="alert">{error.userMessage(isThai)}</p>}

          {rounds.length === 0 && !list.error && (
            <p className="empty-search" role="status">
              {list.data ? t("There is no auction round yet. An admin will open one.", "ยังไม่มีรอบประมูล แอดมินจะเปิดรอบให้") : t("Loading…", "กำลังโหลด…")}
            </p>
          )}

          {round && phase && (
            <section className={`round-panel ${phase === "open" ? "" : "closed"}`} data-phase={phase}>
              <div className="round-status">
                <span className="timer-icon">{isOpenNow ? <LockOpen size={17} /> : <Lock size={17} />}</span>
                <div>
                  <strong>{phaseText[phase]}</strong>
                  <small>
                    {round.type === "liveClaim"
                      ? t(`Claim up to ${round.winCap ?? 5} items. First come, first served.`, `จองได้สูงสุด ${round.winCap ?? 5} ชิ้น ใครมาก่อนได้ก่อน`)
                      : t("Rank the items you want. One item per category is allocated by queue order when the round closes.", "จัดอันดับไอเท็มที่ต้องการ เมื่อปิดรอบจะจัดสรรตามลำดับคิวหมวดละหนึ่งชิ้น")}
                  </small>
                </div>
              </div>
              <div className="timer">
                <strong>{isOpenNow ? formatClock(timeLeft) : phase === "starting" ? formatClock(startsIn) : "--:--"}</strong>
              </div>
            </section>
          )}

          {round?.status === "draft" && (
            <p className="empty-search" role="status">
              {t("This is a draft round: only admins can see it. Editing and starting rounds is done through the admin API for now.", "นี่คือรอบฉบับร่าง เห็นได้เฉพาะแอดมิน ตอนนี้การแก้ไขและเริ่มรอบทำผ่าน API ของแอดมิน")}
            </p>
          )}

          {round && phase && round.status !== "closed" && round.status !== "cancelled" && round.type === "liveClaim" && (
            <LiveClaimBoard round={round} phase={phase} isThai={isThai} memberId={memberId} ignOf={ignOf} notify={notify} apply={apply} refresh={refresh} />
          )}
          {round && phase && round.status !== "closed" && round.status !== "cancelled" && round.type === "queueRanked" && (round.status === "open" || round.status === "draft") && (
            <QueueRoundBoard key={round.id} round={round} phase={phase} isThai={isThai} ignOf={ignOf} notify={notify} />
          )}
          {round?.status === "closed" && (
            <RoundResults key={round.id} round={round} isThai={isThai} isAdmin={isAdmin} memberId={memberId} ignOf={ignOf} onOpenRound={setPicked} />
          )}
          {round?.status === "cancelled" && <p className="empty-search">{t("This round was cancelled.", "รอบนี้ถูกยกเลิก")}</p>}
        </>
      )}

      {phase === "starting" && startsIn > 0 && startsIn <= 5 && (
        <div className="countdown-backdrop" role="status" aria-live="assertive">
          <div className="countdown-modal">
            <span>{round?.name}</span>
            <strong>{startsIn}</strong>
            <small>{t("Round starting", "รอบกำลังจะเริ่ม")}</small>
          </div>
        </div>
      )}

      {isAdmin && (
        <p className="admin-note">
          {t("Admin: creating, starting and closing rounds is not in this screen yet; use the admin API. You can open any round above, including drafts.", "แอดมิน: การสร้าง เริ่ม และปิดรอบยังไม่มีในหน้านี้ ใช้ผ่าน API ของแอดมิน คุณเปิดดูรอบใดก็ได้ รวมถึงฉบับร่าง")}
        </p>
      )}
    </div>
  );
}
