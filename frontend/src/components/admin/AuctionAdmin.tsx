import { useState } from "react";
import {
  ApiError,
  cancelRound,
  closeRound,
  createRound,
  getResults,
  getRound,
  getRoundPreferences,
  listRounds,
  startRound,
  updateRound,
  usePolling,
  type RoundListEntry,
} from "../../api";
import type { GuildMember } from "../../data/guild";
import RoundForm from "./RoundForm";
import { emptyRound, type RoundFormValue } from "./roundFormModel";
import { adminErrorText } from "./adminShared";

type Props = { isThai: boolean; members: GuildMember[]; notify: (message: string) => void };

type Editing = { mode: "new" } | { mode: "edit"; id: number; initial: RoundFormValue };
type Prefs = { roundId: number; lines: { ign: string; items: string[] }[] };

/** Round management: create, edit drafts, start, close early, cancel, review the leftover draft, see preference lists. */
export default function AuctionAdmin({ isThai, members, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const list = usePolling(listRounds, { intervalMs: 5000, key: "admin-rounds" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<{ id: number; delay: number; duration: number } | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const ignOf = (id: string) => members.find((m) => m.id === id)?.ign ?? (isThai ? "อดีตสมาชิก" : "Former member");
  const rounds = list.data ?? [];

  const typeLabel = (r: Pick<RoundListEntry, "type">) => (r.type === "liveClaim" ? t("live claim", "จองสด") : t("ranked queue", "จัดอันดับคิว"));
  const statusLabel = (s: RoundListEntry["status"]) => ({ draft: t("Draft", "ฉบับร่าง"), open: t("Open", "เปิดอยู่"), closed: t("Closed", "ปิดแล้ว"), cancelled: t("Cancelled", "ยกเลิก") })[s];

  /** ANOTHER_ROUND_OPEN gets a plain explanation that names the round to close first. */
  function startErrorText(err: unknown, round: RoundListEntry) {
    if (err instanceof ApiError && err.code === "ANOTHER_ROUND_OPEN") {
      const other = err.details.roundId ? ` (#${String(err.details.roundId)})` : "";
      return t(
        `Another ${typeLabel(round)} round${other} is already open. Only one round of each type can be open at a time: close it first, then start this one.`,
        `มีรอบ${typeLabel(round)}${other} เปิดอยู่แล้ว เปิดได้ครั้งละหนึ่งรอบต่อประเภท กรุณาปิดรอบนั้นก่อน แล้วจึงเริ่มรอบนี้`,
      );
    }
    return adminErrorText(err, isThai);
  }

  async function run(action: () => Promise<unknown>, done: string, onError?: (err: unknown) => string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      notify(done);
    } catch (err) {
      setError(onError ? onError(err) : adminErrorText(err, isThai));
    } finally {
      setBusy(false);
      list.refresh();
    }
  }

  async function edit(round: RoundListEntry) {
    setError(null);
    setFormError(null);
    try {
      const res = await getRound(round.id, null);
      if (!res) return;
      const r = res.round;
      setEditing({ mode: "edit", id: r.id, initial: { type: r.type, name: r.name, durationSec: r.durationSec, startDelaySec: r.startDelaySec, winCap: r.winCap ?? 5, items: r.items.map((i) => ({ name: i.name, category: i.category, rarity: i.rarity ?? "", imageUrl: i.imageUrl ?? "", disabled: i.disabled })) } });
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  async function submitForm(value: RoundFormValue) {
    setBusy(true);
    setFormError(null);
    try {
      if (editing?.mode === "edit") await updateRound(editing.id, value);
      else await createRound(value.type, value);
      notify(editing?.mode === "edit" ? t("Draft saved.", "บันทึกฉบับร่างแล้ว") : t("Round created as a draft. Start it when you are ready.", "สร้างรอบเป็นฉบับร่างแล้ว กดเริ่มเมื่อพร้อม"));
      setEditing(null);
    } catch (err) {
      setFormError(adminErrorText(err, isThai));
    } finally {
      setBusy(false);
      list.refresh();
    }
  }

  async function openLeftover(round: RoundListEntry) {
    setError(null);
    try {
      const results = await getResults(round.id);
      const draft = rounds.find((r) => r.id === results.leftoverRoundId);
      if (!draft) return notify(t("This round has no leftover draft.", "รอบนี้ไม่มีรอบไอเท็มที่เหลือ"));
      await edit(draft);
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  async function showPrefs(round: RoundListEntry) {
    setError(null);
    try {
      const [lists, detail] = await Promise.all([getRoundPreferences(round.id), getRound(round.id, null)]);
      const names = new Map((detail?.round.items ?? []).map((i) => [i.id, i.name]));
      setPrefs({ roundId: round.id, lines: lists.map((l) => ({ ign: ignOf(l.memberId), items: l.itemIds.map((id) => names.get(id) ?? `#${id}`) })) });
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  return (
    <div className="admin-section" data-admin="auctions">
      <div className="admin-toolbar">
        <h3>{t("Auction rounds", "รอบประมูล")}</h3>
        <button type="button" className="admin-button" onClick={() => { setFormError(null); setEditing({ mode: "new" }); }}>
          {t("New round", "รอบใหม่")}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {list.error && <p className="form-error" role="alert">{list.error.userMessage(isThai)}</p>}

      {editing && (
        <RoundForm
          key={editing.mode === "edit" ? editing.id : "new"}
          initial={editing.mode === "edit" ? editing.initial : emptyRound()}
          isNew={editing.mode === "new"}
          isThai={isThai}
          busy={busy}
          error={formError}
          onSubmit={(v) => void submitForm(v)}
          onCancel={() => setEditing(null)}
        />
      )}

      <ul className="admin-list">
        {rounds.map((r) => (
          <li key={r.id} data-round={r.id}>
            <div className="admin-row-main">
              <strong>#{r.id} {r.name}</strong>
              <small>{typeLabel(r)} · {statusLabel(r.status)} · {r.itemCount} {t("items", "ชิ้น")}</small>
            </div>
            <div className="admin-row-actions">
              {r.status === "draft" && (
                <>
                  <button type="button" className="copy-button" disabled={busy} onClick={() => void edit(r)}>{t("Edit", "แก้ไข")}</button>
                  <button type="button" className="admin-button" disabled={busy} onClick={() => setStarting({ id: r.id, delay: r.startDelaySec, duration: r.durationSec })}>{t("Start…", "เริ่ม…")}</button>
                  <button type="button" className="copy-button danger" disabled={busy} onClick={() => void run(() => cancelRound(r.id), t("Round cancelled.", "ยกเลิกรอบแล้ว"))}>{t("Cancel round", "ยกเลิกรอบ")}</button>
                </>
              )}
              {r.status === "open" && (
                <>
                  <button type="button" className="admin-button" disabled={busy} onClick={() => void run(() => closeRound(r.id), t("Round closed.", "ปิดรอบแล้ว"))}>{t("Close now", "ปิดรอบตอนนี้")}</button>
                  <button type="button" className="copy-button danger" disabled={busy} onClick={() => void run(() => cancelRound(r.id), t("Round cancelled.", "ยกเลิกรอบแล้ว"))}>{t("Cancel round", "ยกเลิกรอบ")}</button>
                </>
              )}
              {r.status === "closed" && (
                <button type="button" className="copy-button" onClick={() => void openLeftover(r)}>{t("Leftover draft", "รอบไอเท็มที่เหลือ")}</button>
              )}
              {r.type === "queueRanked" && r.status !== "draft" && (
                <button type="button" className="copy-button" onClick={() => void showPrefs(r)}>{t("Preference lists", "รายการจัดอันดับ")}</button>
              )}
            </div>
            {starting?.id === r.id && (
              <div className="start-panel">
                <label><span>{t("Start delay (s)", "หน่วงก่อนเริ่ม (วินาที)")}</span><input type="number" value={starting.delay} min={0} max={60} onChange={(e) => setStarting({ ...starting, delay: Number(e.target.value) })} aria-label={t("Start delay (s)", "หน่วงก่อนเริ่ม (วินาที)")} /></label>
                <label><span>{t("Duration (s)", "ระยะเวลา (วินาที)")}</span><input type="number" value={starting.duration} min={5} max={86400} onChange={(e) => setStarting({ ...starting, duration: Number(e.target.value) })} aria-label={t("Duration (s)", "ระยะเวลา (วินาที)")} /></label>
                <button type="button" className="admin-button" disabled={busy} onClick={() => void run(async () => { await startRound(r.id, { startDelaySec: starting.delay, durationSec: starting.duration }); setStarting(null); }, t("Round started.", "เริ่มรอบแล้ว"), (err) => startErrorText(err, r))}>{t("Start round", "เริ่มรอบ")}</button>
                <button type="button" className="copy-button" onClick={() => setStarting(null)}>{t("Cancel", "ยกเลิก")}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {rounds.length === 0 && list.data && <p className="empty-search">{t("No rounds yet.", "ยังไม่มีรอบ")}</p>}

      {prefs && (
        <section className="prefs-view" data-testid="prefs-view">
          <h4>{t(`Preference lists of round #${prefs.roundId}`, `รายการจัดอันดับของรอบ #${prefs.roundId}`)} <button type="button" className="copy-button" onClick={() => setPrefs(null)}>{t("Hide", "ซ่อน")}</button></h4>
          {prefs.lines.length === 0 ? <p className="empty-search">{t("Nobody has submitted a list.", "ยังไม่มีใครส่งรายการ")}</p> : (
            <ul>{prefs.lines.map((l) => <li key={l.ign}><strong>{l.ign}</strong>: {l.items.map((n, i) => `${i + 1}. ${n}`).join("  ")}</li>)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
