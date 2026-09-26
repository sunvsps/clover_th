import { useState, type FormEvent } from "react";
import { type Category, type RoundItemInput, type RoundSummary } from "../../api";
import CategoryDots from "./CategoryDots";
import { categoryStripe } from "../categoryStyle";
import type { RoundFormValue } from "./roundFormModel";

const ITEMS_PER_PAGE = 4;
const MIN_PAGES = 1;
const MAX_PAGES = 50;

/** Resizes to `pages * ITEMS_PER_PAGE` items named "Item 1" … "Item N", keeping any category already set by clicking. */
function resizeItems(current: RoundItemInput[], pages: number): RoundItemInput[] {
  const count = Math.max(MIN_PAGES, Math.min(MAX_PAGES, pages)) * ITEMS_PER_PAGE;
  return Array.from({ length: count }, (_, i) => ({ name: `Item ${i + 1}`, category: current[i]?.category, rarity: null, imageUrl: null }));
}

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

/**
 * Create a round, or edit a draft: type (new only), name, timing, cap (live claim) and a page count. Items are
 * auto-generated ("Item 1" … "Item N", `pages * 4` of them) — no per-item name/rarity/image entry. The preview
 * below renders each item as a card exactly like the real auction board (see LiveClaimBoard); click a card to
 * pick its category. Optional for a live-claim round (an untouched item is created without a category); a ranked queue round needs one on every item.
 */
export default function RoundForm({ initial, isNew, isThai, busy, error, onSubmit, onCancel }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [pagesInput, setPagesInput] = useState(() => String(Math.max(MIN_PAGES, isNew ? 1 : Math.ceil(initial.items.length / ITEMS_PER_PAGE))));
  const pages = pagesInput === "" ? MIN_PAGES : Math.max(MIN_PAGES, Math.min(MAX_PAGES, Number(pagesInput) || MIN_PAGES));
  const [v, setV] = useState<RoundFormValue>(() => (isNew ? { ...initial, items: resizeItems([], pages) } : initial));
  // Indexes of preview cards the admin unticked (every card starts ticked; a draft being edited keeps its own). A
  // disabled item is still saved in its slot, so the auction board matches this preview, but it can't be claimed or
  // ranked there.
  const [off, setOff] = useState<Set<number>>(() => new Set(isNew ? [] : initial.items.flatMap((item, i) => (item.disabled ? [i] : []))));
  const enabledItems = v.items.filter((_, i) => !off.has(i));
  const toggleItem = (index: number) =>
    setOff((cur) => {
      const next = new Set(cur);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const problems: string[] = [];
  if (!v.name.trim()) problems.push(t("Give the round a name.", "ตั้งชื่อรอบ"));
  if (v.durationSec < 5 || v.durationSec > 86400) problems.push(t("Duration must be 5 to 86400 seconds.", "ระยะเวลาต้อง 5 ถึง 86400 วินาที"));
  if (v.startDelaySec < 0 || v.startDelaySec > 60) problems.push(t("Start delay must be 0 to 60 seconds.", "เวลาหน่วงก่อนเริ่มต้อง 0 ถึง 60 วินาที"));
  if (enabledItems.length === 0) problems.push(t("Tick at least one item.", "เลือกใช้งานไอเท็มอย่างน้อย 1 ชิ้น"));
  if (v.type === "queueRanked" && enabledItems.some((i) => !i.category))
    problems.push(t("A ranked queue round needs a category on every item.", "รอบจัดอันดับคิวต้องระบุหมวดให้ไอเท็มทุกชิ้น"));
  if (v.type === "liveClaim" && (v.winCap < 1 || v.winCap > 50)) problems.push(t("Items per member must be 1 to 50.", "จำนวนต่อคนต้อง 1 ถึง 50"));

  /** Lets the field go fully blank while typing; a blank field behaves as 1 page (see `pages` above) and is
   * repainted to "1" on blur so it never submits looking empty. */
  function handlePagesChange(raw: string) {
    setPagesInput(raw);
    const next = raw === "" ? MIN_PAGES : Math.max(MIN_PAGES, Math.min(MAX_PAGES, Number(raw) || MIN_PAGES));
    setV((cur) => ({ ...cur, items: resizeItems(cur.items, next) }));
    setOff((cur) => new Set([...cur].filter((i) => i < next * ITEMS_PER_PAGE)));
  }
  function handlePagesBlur() {
    if (pagesInput !== String(pages)) setPagesInput(String(pages));
  }

  /** Sets (or, with undefined, clears) one item's category. */
  function setItemCategory(index: number, category: Category | undefined) {
    setV((cur) => ({ ...cur, items: cur.items.map((item, i) => (i === index ? { ...item, category } : item)) }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length === 0) onSubmit({ ...v, name: v.name.trim(), items: v.items.map((item, i) => ({ ...item, disabled: off.has(i) })) });
  }

  return (
    <form className="round-form" onSubmit={submit} aria-label={isNew ? t("New round", "รอบใหม่") : t("Edit draft round", "แก้ไขรอบฉบับร่าง")}>
      <h3>{isNew ? t("New round", "รอบใหม่") : t("Edit draft round", "แก้ไขรอบฉบับร่าง")}</h3>
      <div className="type-row">
        <span id="round-type-label">{t("Type", "ประเภท")}</span>
        <div className="segmented" role="radiogroup" aria-labelledby="round-type-label">
          {(["liveClaim", "queueRanked"] as RoundSummary["type"][]).map((type) => (
            <button
              type="button"
              key={type}
              role="radio"
              aria-checked={v.type === type}
              className={v.type === type ? "active" : ""}
              disabled={!isNew && v.type !== type}
              onClick={() => isNew && setV({ ...v, type })}
            >
              {type === "liveClaim" ? t("Live claim", "จองสด") : t("Ranked queue", "จัดอันดับคิว")}
            </button>
          ))}
        </div>
        <small>{v.type === "liveClaim" ? t("First come, first served", "ใครมาก่อนได้ก่อน") : t("Allocated by queue order", "แจกตามลำดับคิว")}</small>
      </div>
      <div className="form-grid">
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
        <label>
          <span>{t("Pages", "จำนวนหน้า")}</span>
          <input type="number" value={pagesInput} min={MIN_PAGES} max={MAX_PAGES} onChange={(e) => handlePagesChange(e.target.value)} onBlur={handlePagesBlur} aria-label={t("Pages", "จำนวนหน้า")} />
        </label>
      </div>

      <div className="round-form-preview-head">
        <h4>
          {t("Item preview", "ตัวอย่างไอเท็ม")} <small>{enabledItems.length}/{v.items.length}</small>
        </h4>
        <div className="round-form-preview-bulk">
          <button type="button" className="copy-button" disabled={off.size === 0} onClick={() => setOff(new Set())}>
            {t("Enable all", "เปิดทั้งหมด")}
          </button>
          <button type="button" className="copy-button" disabled={off.size === v.items.length} onClick={() => setOff(new Set(v.items.map((_, i) => i)))}>
            {t("Disable all", "ปิดทั้งหมด")}
          </button>
        </div>
      </div>
      <p className="form-hint">
        {v.type === "queueRanked"
          ? t("Click a color dot to pick a category (click it again to clear). A ranked queue round needs a category on every item.", "กดจุดสีเพื่อเลือกหมวด (กดซ้ำเพื่อยกเลิก) รอบจัดอันดับคิวต้องระบุหมวดทุกชิ้น")
          : t("Click a color dot to pick a category (click it again to clear) — optional; an item left unset is created without one.", "กดจุดสีเพื่อเลือกหมวด (กดซ้ำเพื่อยกเลิก) ไม่บังคับ — ถ้าไม่เลือก ไอเท็มจะไม่มีหมวด")}{" "}
        {t("Untick a card to disable that item: it keeps its slot but can't be reserved.", "เอาติ๊กออกเพื่อปิดใช้งานไอเท็มนั้น: ยังอยู่ในช่องเดิมแต่จองไม่ได้")}
      </p>
      <div className="round-form-preview">
        {Array.from({ length: pages }, (_, page) => (
          <section key={page} aria-label={`Page ${page + 1}`}>
            <p className="round-form-preview-page">{t(`Page ${page + 1}`, `หน้า ${page + 1}`)}</p>
            <div className="item-grid">
              {v.items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE).map((item, i) => {
                const index = page * ITEMS_PER_PAGE + i;
                const enabled = !off.has(index);
                // numbered 1-4 within each page; the saved name stays "Item N" (N = position in the whole round)
                const label = `Item ${i + 1}`;
                const where = t(`${label} on page ${page + 1}`, `${label} หน้า ${page + 1}`);
                return (
                  <div className={`item-card available ${enabled ? categoryStripe(item.category) : "cat-stripe item-off"}`} key={item.name}>
                    <input
                      type="checkbox"
                      className="item-enable"
                      checked={enabled}
                      onChange={() => toggleItem(index)}
                      aria-label={t(`Use ${where}`, `ใช้ ${where}`)}
                      title={enabled ? t("Enabled — untick to disable", "ใช้งาน — เอาติ๊กออกเพื่อปิด") : t("Disabled — tick to enable", "ปิดใช้งาน — ติ๊กเพื่อเปิด")}
                    />
                    <div className="item-info">
                      <h3>{label}</h3>
                      {enabled ? (
                        <CategoryDots
                          value={item.category}
                          isThai={isThai}
                          label={t(`${where} category`, `หมวดของ ${where}`)}
                          onChange={(category) => setItemCategory(index, category)}
                        />
                      ) : (
                        <span className="cat-pill none">{t("Disabled", "ปิดใช้งาน")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

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
