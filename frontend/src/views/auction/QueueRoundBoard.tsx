import { useEffect, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";
import { getMyPreferences, putMyPreferences, type Round } from "../../api";
import { auctionErrorText, categoryLabel, groupByCategory, moveInList, sameList, type Phase } from "./auctionModel";

type Props = {
  round: Round;
  phase: Phase;
  isThai: boolean;
  ignOf: (memberId: string) => string;
  notify: (message: string) => void;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; count: number } | { kind: "failed"; message: string };

/**
 * Type 2 (ranked queues), while the round is open: the member ranks items. Only categories where they were in the
 * queue when the round opened (`eligibleCategories`) accept items. Nothing is sent until "Save my list"; a 200 from
 * the server means the list is stored.
 */
export default function QueueRoundBoard({ round, phase, isThai, notify, ignOf }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [saved, setSaved] = useState<number[] | null>(null); // the list the server holds
  const [draft, setDraft] = useState<number[] | null>(null); // unsaved edits (null = none)
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [loadFailed, setLoadFailed] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyPreferences(round.id).then(
      (ids) => !cancelled && setSaved(ids),
      (err) => {
        if (cancelled) return;
        setLoadFailed(true);
        notify(auctionErrorText(err, isThai, ignOf));
      },
    );
    return () => {
      cancelled = true;
    };
    // load once per round; language / callbacks changing must not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  const list = draft ?? saved ?? [];
  const dirty = draft !== null && saved !== null && !sameList(draft, saved);
  const byId = new Map(round.items.map((i) => [i.id, i]));
  const eligible = new Set(round.eligibleCategories);
  const open = phase === "open";
  const canEdit = open && saved !== null;

  const edit = (next: number[]) => {
    setDraft(next);
    setState({ kind: "idle" });
  };

  async function save() {
    setState({ kind: "saving" });
    try {
      const stored = await putMyPreferences(round.id, list);
      setSaved(stored);
      setDraft(null);
      setState({ kind: "saved", count: stored.length });
      notify(t(`Saved: your list of ${stored.length} items is stored.`, `บันทึกแล้ว: รายการ ${stored.length} ชิ้นถูกเก็บไว้`));
    } catch (err) {
      const message = auctionErrorText(err, isThai, ignOf);
      setState({ kind: "failed", message });
      notify(message);
    }
  }

  const drop = (e: DragEvent<HTMLElement>, to: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== to) edit(moveInList(list, dragIndex, to - dragIndex));
    setDragIndex(null);
  };

  return (
    <div className="queue-round" data-testid="queue-round">
      <p className="queue-help">
        {round.eligibleCategories.length === 0
          ? t("You were not in any queue when this round opened, so you cannot rank items in it.", "คุณไม่ได้อยู่ในคิวใดตอนเปิดรอบนี้ จึงจัดอันดับไอเท็มไม่ได้")
          : t(
              `You can rank items in: ${round.eligibleCategories.map((c) => categoryLabel(c, false)).join(", ")}. Put the items you want most first, then save.`,
              `คุณจัดอันดับได้ในหมวด: ${round.eligibleCategories.map((c) => categoryLabel(c, true)).join(", ")} ใส่ไอเท็มที่ต้องการมากที่สุดไว้บนสุด แล้วกดบันทึก`,
            )}
      </p>

      <section className="my-ranking">
        <h3>
          {t("My ranking", "อันดับของฉัน")} <small>{list.length}</small>
        </h3>
        {loadFailed && <p role="alert">{t("Could not load your saved list.", "โหลดรายการที่บันทึกไว้ไม่ได้")}</p>}
        {list.length === 0 ? (
          <p className="empty-search">{t("Your list is empty.", "รายการของคุณว่าง")}</p>
        ) : (
          <ol className="ranking-list" aria-label={t("My ranking", "อันดับของฉัน")}>
            {list.map((id, index) => {
              const item = byId.get(id);
              return (
                <li
                  key={id}
                  className="ranking-row"
                  draggable={canEdit}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => drop(e, index)}
                >
                  <b>{index + 1}</b>
                  <span className="rank-name">
                    {item?.name ?? `#${id}`} <small>{item ? categoryLabel(item.category, isThai) : ""}</small>
                  </span>
                  <span className="rank-tools">
                    <button type="button" disabled={!canEdit || index === 0} aria-label={t(`Move ${item?.name} up`, `เลื่อน ${item?.name} ขึ้น`)} onClick={() => edit(moveInList(list, index, -1))}>
                      <ArrowUp size={12} />
                    </button>
                    <button type="button" disabled={!canEdit || index === list.length - 1} aria-label={t(`Move ${item?.name} down`, `เลื่อน ${item?.name} ลง`)} onClick={() => edit(moveInList(list, index, 1))}>
                      <ArrowDown size={12} />
                    </button>
                    <button type="button" disabled={!canEdit} aria-label={t(`Remove ${item?.name}`, `นำ ${item?.name} ออก`)} onClick={() => edit(list.filter((x) => x !== id))}>
                      <X size={12} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="save-row">
          <button type="button" className="admin-button" disabled={!canEdit || !dirty || state.kind === "saving"} onClick={() => void save()}>
            <Save size={13} /> {t("Save my list", "บันทึกรายการ")}
          </button>
          {dirty && <span className="unsaved">{t("Not saved yet", "ยังไม่ได้บันทึก")}</span>}
          {state.kind === "saved" && (
            <span className="save-ok" role="status">
              {t(`Saved (${state.count} items stored).`, `บันทึกแล้ว (${state.count} ชิ้น)`)}
            </span>
          )}
          {state.kind === "failed" && (
            <span className="save-failed" role="alert">
              {t("Not saved: ", "ยังไม่ได้บันทึก: ")}
              {state.message}
            </span>
          )}
        </div>
      </section>

      {groupByCategory(round.items).map(({ category, items }) => {
        const ok = eligible.has(category);
        return (
          <section className={`category-block ${ok ? "" : "locked"}`} key={category} data-category={category}>
            <h3>
              {categoryLabel(category, isThai)} <small>{items.length}</small>
            </h3>
            {!ok && <p className="empty-search">{t("You were not in this queue when the round opened, so these items cannot be ranked.", "คุณไม่ได้อยู่ในคิวนี้ตอนเปิดรอบ จึงจัดอันดับไอเท็มเหล่านี้ไม่ได้")}</p>}
            <div className="item-grid">
              {items.map((item) => {
                const inList = list.includes(item.id);
                return (
                  <div className={`item-card ${inList ? "mine" : "available"}`} key={item.id} data-item={item.name}>
                    <div className="item-info">
                      <h3>{item.name}</h3>
                      <small>{item.rarity ?? ""}</small>
                    </div>
                    {ok && (
                      <button type="button" className="claim-button" disabled={!canEdit || inList} onClick={() => edit([...list, item.id])}>
                        <Plus size={12} /> {inList ? t("In my list", "อยู่ในรายการ") : t("Add", "เพิ่ม")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
