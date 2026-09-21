import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CATEGORIES, type Category, type RoundItemInput, type RoundSummary } from "../../api";
import { categoryLabel } from "../../views/auction/auctionModel";
import { isHttpsUrl } from "./adminShared";
import type { RoundFormValue } from "./roundFormModel";

type Props = {
  /** `null` type-picker means a new round; an existing draft keeps its type */
  initial: RoundFormValue;
  isNew: boolean;
  isThai: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (value: RoundFormValue) => void;
  onCancel: () => void;
};

/** Create a round, or edit a draft: type (new only), name, timing, cap (live claim) and the item rows. */
export default function RoundForm({ initial, isNew, isThai, busy, error, onSubmit, onCancel }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [v, setV] = useState<RoundFormValue>(initial);
  const patchItem = (i: number, p: Partial<RoundItemInput>) => setV((cur) => ({ ...cur, items: cur.items.map((it, n) => (n === i ? { ...it, ...p } : it)) }));
  const badUrl = (url?: string | null) => Boolean(url && url.trim() && !isHttpsUrl(url.trim()));
  const problems: string[] = [];
  if (!v.name.trim()) problems.push(t("Give the round a name.", "ตั้งชื่อรอบ"));
  if (v.durationSec < 5 || v.durationSec > 86400) problems.push(t("Duration must be 5 to 86400 seconds.", "ระยะเวลาต้อง 5 ถึง 86400 วินาที"));
  if (v.startDelaySec < 0 || v.startDelaySec > 60) problems.push(t("Start delay must be 0 to 60 seconds.", "เวลาหน่วงก่อนเริ่มต้อง 0 ถึง 60 วินาที"));
  if (v.items.some((i) => !i.name.trim())) problems.push(t("Every item needs a name.", "ไอเท็มทุกชิ้นต้องมีชื่อ"));
  if (v.items.some((i) => badUrl(i.imageUrl))) problems.push(t("Image links must be https:// URLs.", "ลิงก์รูปต้องเป็น https:// เท่านั้น"));
  if (v.type === "queueRanked" && v.items.some((i) => !["gear", "card", "relic"].includes(i.category))) problems.push(t("A queue round accepts only Gear, Card and Relic items.", "รอบคิวรับเฉพาะ Gear, Card และ Relic"));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length === 0) onSubmit({ ...v, name: v.name.trim(), items: v.items.map((i) => ({ ...i, name: i.name.trim(), rarity: i.rarity?.trim() || null, imageUrl: i.imageUrl?.trim() || null })) });
  }

  return (
    <form className="round-form" onSubmit={submit} aria-label={isNew ? t("New round", "รอบใหม่") : t("Edit draft round", "แก้ไขรอบฉบับร่าง")}>
      <h3>{isNew ? t("New round", "รอบใหม่") : t("Edit draft round", "แก้ไขรอบฉบับร่าง")}</h3>
      <div className="form-grid">
        <label>
          <span>{t("Type", "ประเภท")}</span>
          <select value={v.type} disabled={!isNew} onChange={(e) => setV({ ...v, type: e.target.value as RoundSummary["type"] })} aria-label={t("Type", "ประเภท")}>
            <option value="liveClaim">{t("Live claim (first come, first served)", "จองสด (ใครมาก่อนได้ก่อน)")}</option>
            <option value="queueRanked">{t("Ranked queue", "จัดอันดับตามคิว")}</option>
          </select>
        </label>
        <label>
          <span>{t("Name", "ชื่อรอบ")}</span>
          <input type="text" value={v.name} maxLength={100} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label={t("Name", "ชื่อรอบ")} />
        </label>
        <label>
          <span>{t("Duration (seconds)", "ระยะเวลา (วินาที)")}</span>
          <input type="number" value={v.durationSec} min={5} max={86400} onChange={(e) => setV({ ...v, durationSec: Number(e.target.value) })} aria-label={t("Duration (seconds)", "ระยะเวลา (วินาที)")} />
        </label>
        <label>
          <span>{t("Start delay (seconds)", "หน่วงก่อนเริ่ม (วินาที)")}</span>
          <input type="number" value={v.startDelaySec} min={0} max={60} onChange={(e) => setV({ ...v, startDelaySec: Number(e.target.value) })} aria-label={t("Start delay (seconds)", "หน่วงก่อนเริ่ม (วินาที)")} />
        </label>
        {v.type === "liveClaim" && (
          <label>
            <span>{t("Items per member (cap)", "จำนวนต่อคน (สูงสุด)")}</span>
            <input type="number" value={v.winCap} min={1} max={50} onChange={(e) => setV({ ...v, winCap: Number(e.target.value) })} aria-label={t("Items per member (cap)", "จำนวนต่อคน (สูงสุด)")} />
          </label>
        )}
      </div>

      <h4>{t("Items", "ไอเท็ม")} <small>{v.items.length}</small></h4>
      <ul className="item-rows">
        {v.items.map((item, i) => (
          <li key={i} className="item-row">
            <input type="text" value={item.name} maxLength={100} placeholder={t("Item name", "ชื่อไอเท็ม")} aria-label={t(`Item ${i + 1} name`, `ชื่อไอเท็ม ${i + 1}`)} onChange={(e) => patchItem(i, { name: e.target.value })} />
            <select value={item.category} aria-label={t(`Item ${i + 1} category`, `หมวดไอเท็ม ${i + 1}`)} onChange={(e) => patchItem(i, { category: e.target.value as Category })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{categoryLabel(c, isThai)}</option>
              ))}
            </select>
            <input type="text" value={item.rarity ?? ""} maxLength={32} placeholder={t("Rarity", "ระดับ")} aria-label={t(`Item ${i + 1} rarity`, `ระดับไอเท็ม ${i + 1}`)} onChange={(e) => patchItem(i, { rarity: e.target.value })} />
            <input type="url" value={item.imageUrl ?? ""} placeholder="https://…" aria-label={t(`Item ${i + 1} image link`, `ลิงก์รูปไอเท็ม ${i + 1}`)} aria-invalid={badUrl(item.imageUrl)} onChange={(e) => patchItem(i, { imageUrl: e.target.value })} />
            <button type="button" className="chip-tool remove" aria-label={t(`Remove item ${i + 1}`, `นำไอเท็ม ${i + 1} ออก`)} onClick={() => setV({ ...v, items: v.items.filter((_, n) => n !== i) })}>
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="copy-button" onClick={() => setV({ ...v, items: [...v.items, { name: "", category: v.items.at(-1)?.category ?? "pet", rarity: "", imageUrl: "" }] })}>
        <Plus size={13} /> {t("Add item", "เพิ่มไอเท็ม")}
      </button>

      {problems.map((p) => (
        <p className="form-error" key={p} role="note">{p}</p>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions">
        <button type="button" className="copy-button" onClick={onCancel}>{t("Cancel", "ยกเลิก")}</button>
        <button type="submit" className="admin-button" disabled={busy || problems.length > 0}>
          {isNew ? t("Create round", "สร้างรอบ") : t("Save draft", "บันทึกฉบับร่าง")}
        </button>
      </div>
    </form>
  );
}
