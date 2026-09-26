import { ListOrdered, Trophy, X } from "lucide-react";
import type { Category } from "../../api";
import CategoryPill from "../CategoryPill";
import { CATEGORY_ICONS } from "../categoryStyle";

export type PrefsData = {
  roundId: number;
  roundName: string;
  closed: boolean;
  /** the round's items in board order, with their winner once allocated */
  items: { id: number; label: string; category: Category | null; winnerId: string | null; queuePos: number | null }[];
  lists: { memberId: string; itemIds: number[] }[];
};

type Props = { data: PrefsData; isThai: boolean; ignOf: (memberId: string) => string; onClose: () => void };

/**
 * A queue round's preference lists seen from the items: one row per item with everyone who ranked it (and at which
 * rank), the winner first with a trophy once the round is closed. Rows stay in board order (P1·1, P1·2, …); an
 * item nobody ranked is dimmed in its place.
 */
export default function PrefsDialog({ data, isThai, ignOf, onClose }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const wanted = data.items.map((item) => {
    const by = data.lists
      .flatMap((l) => {
        const rank = l.itemIds.indexOf(item.id);
        return rank === -1 ? [] : [{ memberId: l.memberId, rank: rank + 1 }];
      })
      .sort((a, b) => Number(b.memberId === item.winnerId) - Number(a.memberId === item.winnerId) || a.rank - b.rank || ignOf(a.memberId).localeCompare(ignOf(b.memberId)));
    return { item, by };
  });
  const categories = [...new Set(data.items.map((i) => i.category))];
  const oneCategory = categories.length === 1 ? categories[0]! : undefined;
  const winners = new Set(data.items.map((i) => i.winnerId).filter(Boolean)).size;

  const itemCell = (item: PrefsData["items"][number]) => {
    const Icon = !oneCategory && item.category ? CATEGORY_ICONS[item.category] : undefined;
    return (
      <span className={`prefs-item ${item.category ? `cat-${item.category}` : ""}`}>
        {Icon && <Icon size={12} aria-hidden="true" />}
        {item.label}
      </span>
    );
  };

  return (
    <div className="page-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="page-modal prefs-dialog" role="dialog" aria-modal="true" aria-labelledby="prefs-title" data-testid="prefs-view" onClick={(e) => e.stopPropagation()}>
        <div className="page-modal-header">
          <div>
            <p className="eyebrow"><ListOrdered size={11} /> {t("PREFERENCE LISTS", "รายการจัดอันดับ")}</p>
            <h2 id="prefs-title">#{data.roundId} {data.roundName}</h2>
            <div className="prefs-stats">
              {oneCategory !== undefined && <CategoryPill category={oneCategory} isThai={isThai} />}
              <span>{t(`${data.lists.length} submitted`, `ส่งรายการ ${data.lists.length} คน`)}</span>
              {data.closed ? <span>{t(`${winners} won an item`, `ได้ของ ${winners} คน`)}</span> : <span>{t("Results after the round closes", "ผลการแจกจะแสดงหลังปิดรอบ")}</span>}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("Close", "ปิด")}>×</button>
        </div>

        {data.lists.length === 0 ? (
          <p className="empty-search">{t("Nobody has submitted a list.", "ยังไม่มีใครส่งรายการ")}</p>
        ) : (
          <>
            <p className="prefs-hint">{t("Each item with everyone who ranked it: the number is that member's rank for it (1 = first choice).", "แต่ละชิ้นกับคนที่จัดอันดับไว้ ตัวเลขคืออันดับที่คนนั้นให้ชิ้นนี้ (1 = อยากได้ที่สุด)")}</p>
            <ul className="prefs-items">
              {wanted.map(({ item, by }) => (
                <li key={item.id} data-item={item.label} className={by.length === 0 ? "unranked" : item.winnerId ? "won" : ""}>
                  {itemCell(item)}
                  <span className="prefs-who">
                    {by.map(({ memberId, rank }) => {
                      const win = memberId === item.winnerId;
                      return (
                        <span key={memberId} className={`prefs-person ${win ? "win" : ""}`}>
                          {win && <Trophy size={11} aria-label={t("won", "ได้")} />}
                          {ignOf(memberId)}
                          <span className="prefs-rank">{win ? t(`rank ${rank}`, `อันดับ ${rank}`) : rank}</span>
                        </span>
                      );
                    })}
                    {by.length === 0 ? (
                      <span className="prefs-none">{t("nobody ranked it", "ไม่มีใครจัดอันดับ")}</span>
                    ) : (
                      data.closed && !item.winnerId && <span className="prefs-none">{t("nobody got it", "ไม่มีใครได้")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="editor-actions">
          <button type="button" className="copy-button" onClick={onClose}><X size={12} /> {t("Close", "ปิด")}</button>
        </div>
      </section>
    </div>
  );
}
