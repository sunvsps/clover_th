import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, RotateCcw, X } from "lucide-react";
import { getQueues, listRounds, QUEUE_CATEGORIES, replaceQueue, usePolling, type Category } from "../../api";
import { findJob, jobStyle, type GuildMember, type Job } from "../../data/guild";
import { categoryLabel } from "../../views/auction/auctionModel";
import CategoryPill from "../CategoryPill";
import { CATEGORY_ICONS } from "../categoryStyle";
import { adminErrorText } from "./adminShared";
import MemberPicker from "./MemberPicker";

type Props = { isThai: boolean; members: GuildMember[]; jobs: Job[]; notify: (message: string) => void };

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Edit the order of each auction queue (Gear, Card, Relic): drag a row (or use the arrows) to move a member, remove
 * one, or add a member at the end, then Save. The whole queue is saved at once with the order it was loaded from, so
 * a member who joined or left meanwhile is not overwritten (QUEUE_CHANGED). Saving is refused while a queue round of
 * that category is open, because the open round's eligibility depends on the current order.
 */
export default function QueuesAdmin({ isThai, members, jobs, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const polled = usePolling(getQueues, { intervalMs: 8000, key: "admin-queues" });
  const rounds = usePolling(listRounds, { intervalMs: 10_000, key: "admin-queues-rounds" });
  const openQueueRounds = (rounds.data ?? []).filter((r) => r.type === "queueRanked" && r.status === "open");
  const [category, setCategory] = useState<Category>(QUEUE_CATEGORIES[0]!);
  // an edit in progress per category: the draft order and the server order it started from
  const [edits, setEdits] = useState<Partial<Record<Category, { draft: string[]; base: string[] }>>>({});
  const [adding, setAdding] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const server = polled.data?.find((q) => q.category === category)?.entries.map((e) => e.memberId) ?? [];
  const edit = edits[category];
  const list = edit?.draft ?? server;
  const dirty = !!edit && !same(edit.draft, edit.base);
  const changedMeanwhile = !!edit && !!polled.data && !same(edit.base, server);
  const memberOf = (id: string) => members.find((m) => m.id === id);
  const ignOf = (id: string) => memberOf(id)?.ign ?? t("Former member", "อดีตสมาชิก");
  const addable = members.filter((m) => !list.includes(m.id)).sort((a, b) => a.ign.localeCompare(b.ign));

  function change(next: string[]) {
    setError(null);
    setEdits((all) => ({ ...all, [category]: { draft: next, base: all[category]?.base ?? server } }));
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= list.length) return;
    const next = [...list];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    change(next);
  }
  function reset() {
    setError(null);
    setEdits((all) => {
      const next = { ...all };
      delete next[category];
      return next;
    });
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      await replaceQueue(category, edit.draft, edit.base);
      notify(t(`${categoryLabel(category, false)} queue saved.`, `บันทึกคิว ${categoryLabel(category, true)} แล้ว`));
      reset();
      polled.refresh();
    } catch (err) {
      setError(adminErrorText(err, isThai));
    } finally {
      setBusy(false);
    }
  }

  const onDragStart = (e: DragEvent, index: number) => {
    setDragFrom(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };
  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault();
    const from = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
    if (Number.isInteger(from)) move(from, index);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="admin-section" data-admin="queues">
      <div className="admin-toolbar">
        <div className="cat-tabs" role="tablist" aria-label={t("Queue", "คิว")}>
          {QUEUE_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={c === category} className={`cat-tab cat-${c} ${c === category ? "active" : ""}`} onClick={() => { setCategory(c); setAdding(""); setError(null); }}>
              {(() => {
                const Icon = CATEGORY_ICONS[c];
                return Icon ? <Icon size={14} aria-hidden="true" /> : null;
              })()}
              {categoryLabel(c, isThai)}
              {edits[c] && !same(edits[c]!.draft, edits[c]!.base) && <span className="cat-tab-dirty" title={t("Unsaved changes", "ยังไม่ได้บันทึก")}>•</span>}
            </button>
          ))}
        </div>
        <span className="occurrence-meta">{list.length} {t("in queue", "คนในคิว")}</span>
      </div>

      {openQueueRounds.length > 0 && (
        <p className="queue-edit-note warn" role="note">
          {t(
            `A queue round is open (${openQueueRounds.map((r) => `#${r.id}`).join(", ")}): the queues of its categories can be saved again after it closes.`,
            `มีรอบคิวเปิดอยู่ (${openQueueRounds.map((r) => `#${r.id}`).join(", ")}) คิวของหมวดในรอบนั้นจะบันทึกได้หลังปิดรอบ`,
          )}
        </p>
      )}
      {changedMeanwhile && (
        <p className="queue-edit-note warn" role="note">
          {t("Someone joined or left this queue while you were editing. Reset to load the current order.", "มีคนเข้าหรือออกคิวนี้ระหว่างที่แก้อยู่ กด \"ยกเลิกการแก้\" เพื่อโหลดลำดับล่าสุด")}
        </p>
      )}
      {(error ?? polled.error) && <p className="form-error" role="alert">{error ?? polled.error?.userMessage(isThai)}</p>}

      <div className="queue-edit">
        <div className="queue-edit-head">
          <CategoryPill category={category} isThai={isThai} />
          <small>{t("Drag a row or use the arrows to move a member. Rank 1 is served first.", "ลากแถวหรือกดลูกศรเพื่อย้าย อันดับ 1 ได้ก่อน")}</small>
        </div>
        <ol className="queue-edit-list" aria-label={t(`${categoryLabel(category, false)} queue`, `คิว ${categoryLabel(category, true)}`)}>
          {list.map((id, index) => {
            const job = findJob(jobs, memberOf(id)?.job ?? -1);
            return (
              <li
                key={id}
                draggable
                data-member={ignOf(id)}
                className={`${dragFrom === index ? "dragging" : ""} ${dragOver === index && dragFrom !== index ? "drop-target" : ""}`}
                onDragStart={(e) => onDragStart(e, index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== index) setDragOver(index);
                }}
                onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
                onDrop={(e) => onDrop(e, index)}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <span className="queue-edit-grip" aria-hidden="true"><GripVertical size={14} /></span>
                <span className="queue-edit-rank">#{index + 1}</span>
                <strong>{ignOf(id)}</strong>
                {job && <span className="job-pill" style={jobStyle(job)}>{job.label}</span>}
                <span className="queue-edit-actions">
                  <button type="button" className="chip-tool" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label={t(`Move ${ignOf(id)} up`, `เลื่อน ${ignOf(id)} ขึ้น`)}>
                    <ArrowUp size={11} />
                  </button>
                  <button type="button" className="chip-tool" disabled={index === list.length - 1} onClick={() => move(index, index + 1)} aria-label={t(`Move ${ignOf(id)} down`, `เลื่อน ${ignOf(id)} ลง`)}>
                    <ArrowDown size={11} />
                  </button>
                  <button type="button" className="chip-tool remove" onClick={() => change(list.filter((x) => x !== id))} aria-label={t(`Remove ${ignOf(id)}`, `เอา ${ignOf(id)} ออก`)}>
                    <X size={11} />
                  </button>
                </span>
              </li>
            );
          })}
          {polled.data && list.length === 0 && <li className="queue-edit-empty">{t("Nobody is in this queue.", "ยังไม่มีใครในคิวนี้")}</li>}
        </ol>

        <form
          className="queue-edit-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding) return;
            change([...list, adding]);
            setAdding("");
          }}
        >
          <MemberPicker members={addable} jobs={jobs} value={adding} onChange={setAdding} isThai={isThai} label={t("Member to add", "สมาชิกที่จะเพิ่ม")} />
          <button type="submit" className="admin-button" disabled={!adding}>
            <Plus size={13} /> {t("Add to queue", "เพิ่มคิว")}
          </button>
        </form>
      </div>

      <div className="editor-actions">
        <button type="button" className="copy-button" disabled={!edit || busy} onClick={reset}>
          <RotateCcw size={12} /> {t("Reset", "ยกเลิกการแก้")}
        </button>
        <button type="button" className="admin-button" disabled={!dirty || busy} onClick={() => void save()}>
          <Check size={13} /> {t("Save queue", "บันทึกคิว")}
        </button>
      </div>
    </div>
  );
}
