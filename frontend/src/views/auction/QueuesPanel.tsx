import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { getQueues, joinQueue, leaveQueue, QUEUE_CATEGORIES, usePolling, type Category } from "../../api";
import { auctionErrorText, categoryLabel } from "./auctionModel";

type Props = {
  isThai: boolean;
  enabled: boolean;
  ignOf: (memberId: string) => string;
  notify: (message: string) => void;
};

/** The persistent per-category queues (Gear, Card, Relic): length, my rank, who is in line, join and leave. */
export default function QueuesPanel({ isThai, enabled, ignOf, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const polled = usePolling(() => getQueues(), { intervalMs: 5000, enabled, key: "queues" });
  const [busy, setBusy] = useState<Category | null>(null);
  const queues = polled.data ?? [];

  async function change(category: Category, join: boolean) {
    setBusy(category);
    try {
      const res = await (join ? joinQueue(category) : leaveQueue(category));
      notify(
        join
          ? t(`You are #${res.myRank} in the ${categoryLabel(category, false)} queue.`, `คุณอยู่คิว ${categoryLabel(category, true)} ลำดับที่ ${res.myRank}`)
          : t(`You left the ${categoryLabel(category, false)} queue.`, `คุณออกจากคิว ${categoryLabel(category, true)} แล้ว`),
      );
    } catch (err) {
      notify(auctionErrorText(err, isThai, ignOf));
    } finally {
      setBusy(null);
      polled.refresh();
    }
  }

  return (
    <div className="queues-panel">
      <p className="queue-help">
        {t(
          "Join a queue to be eligible for the next round of that category. Winning an item moves you to the back of the line.",
          "เข้าคิวเพื่อมีสิทธิ์ในรอบถัดไปของหมวดนั้น เมื่อได้ไอเท็มแล้วจะถูกย้ายไปท้ายคิว",
        )}
      </p>
      {QUEUE_CATEGORIES.map((category) => {
        const q = queues.find((x) => x.category === category);
        return (
          <section className="queue-card" key={category} data-queue={category}>
            <div className="queue-head">
              <h3>
                {categoryLabel(category, isThai)} <small>{q?.length ?? 0} {t("in line", "คนในคิว")}</small>
              </h3>
              <span className="my-rank">{q?.myRank ? t(`Your place: #${q.myRank}`, `ลำดับของคุณ: #${q.myRank}`) : t("You are not in this queue", "คุณไม่ได้อยู่ในคิวนี้")}</span>
              {q?.myRank ? (
                <button type="button" className="release-button" disabled={busy === category} onClick={() => void change(category, false)}>
                  <LogOut size={12} /> {t("Leave queue", "ออกจากคิว")}
                </button>
              ) : (
                <button type="button" className="claim-button" disabled={busy === category || !q} onClick={() => void change(category, true)}>
                  <LogIn size={12} /> {t("Join queue", "เข้าคิว")}
                </button>
              )}
            </div>
            {q && q.entries.length > 0 && (
              <ol className="queue-entries">
                {q.entries.map((e) => (
                  <li key={e.memberId} className={q.myRank === e.rank ? "mine" : ""}>
                    {ignOf(e.memberId)}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
