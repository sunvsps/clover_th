import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { getMyResults, getQueues, getResults, type MyResults, type Queue, type Round, type RoundResults as Results } from "../../api";
import { auctionErrorText, categoryLabel, groupByCategory } from "./auctionModel";

type Props = {
  round: Pick<Round, "id" | "type" | "name">;
  isThai: boolean;
  isAdmin: boolean;
  memberId: string;
  ignOf: (memberId: string) => string;
  onOpenRound: (id: number) => void;
};

type Loaded = { results: Results; mine: MyResults; queues: Queue[] | null };

/** A closed round: who won what, the member's own items, and (queue rounds) the new queue order. */
export default function RoundResults({ round, isThai, isAdmin, memberId, ignOf, onOpenRound }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getResults(round.id), getMyResults(round.id), round.type === "queueRanked" ? getQueues() : Promise.resolve(null)]).then(
      ([results, mine, queues]) => !cancelled && setData({ results, mine, queues }),
      (err) => !cancelled && setError(auctionErrorText(err, isThai, ignOf)),
    );
    return () => {
      cancelled = true;
    };
    // fetch once per closed round
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p className="empty-search" role="status">{t("Loading results…", "กำลังโหลดผล…")}</p>;
  const { results, mine, queues } = data;

  return (
    <div className="round-results" data-testid="round-results">
      <section className="my-results">
        <h3>
          <Trophy size={14} /> {t("My results", "ผลของฉัน")} <small>{mine.items.length}</small>
        </h3>
        {mine.items.length === 0 ? (
          <p className="empty-search">{t("You won no items in this round.", "คุณไม่ได้ไอเท็มในรอบนี้")}</p>
        ) : (
          <ul>
            {mine.items.map((i) => (
              <li key={i.id}>
                {i.name} <small>{categoryLabel(i.category, isThai)}{i.winner?.queuePos ? ` · ${t("queue", "คิว")} #${i.winner.queuePos}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {groupByCategory(results.items).map(({ category, items }) => (
        <section className="category-block" key={category} data-category={category}>
          <h3>
            {categoryLabel(category, isThai)} <small>{items.length}</small>
          </h3>
          <ul className="result-list">
            {items.map((item) => (
              <li className={item.winner?.memberId === memberId ? "mine" : ""} key={item.id} data-item={item.name}>
                <span>{item.name}</span>
                <span className="item-owner">
                  {item.winner ? (
                    <>
                      {ignOf(item.winner.memberId)}
                      {item.winner.queuePos ? ` · ${t("queue", "คิว")} #${item.winner.queuePos}` : ""}
                    </>
                  ) : (
                    t("No winner", "ไม่มีผู้ได้")
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {queues && (
        <section className="new-queues" data-testid="new-queues">
          <h3>{t("New queue order", "ลำดับคิวใหม่")}</h3>
          {queues
            .filter((q) => q.length > 0 || results.items.some((i) => i.category === q.category))
            .map((q) => (
              <p key={q.category} data-queue={q.category}>
                <strong>{categoryLabel(q.category, isThai)}</strong>: {q.entries.map((e) => ignOf(e.memberId)).join(", ") || "—"}
              </p>
            ))}
        </section>
      )}

      {isAdmin && results.leftoverRoundId !== null && (
        <button type="button" className="admin-button" onClick={() => onOpenRound(results.leftoverRoundId!)}>
          {t(`Open the leftover draft round #${results.leftoverRoundId}`, `เปิดรอบไอเท็มที่เหลือ (ฉบับร่าง) #${results.leftoverRoundId}`)}
        </button>
      )}
    </div>
  );
}
