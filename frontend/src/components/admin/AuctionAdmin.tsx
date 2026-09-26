import { useState } from "react";
import { Copy, CornerDownRight, ListOrdered, Pencil, Play, Plus, Square, X, Zap } from "lucide-react";
import {
  ApiError,
  cancelRound,
  closeRound,
  createLeftoverDraft,
  createRound,
  getRound,
  getRoundPreferences,
  listRounds,
  startRound,
  updateRound,
  usePolling,
  type RoundListEntry,
} from "../../api";
import type { GuildMember } from "../../data/guild";
import { useServerNow } from "../../hooks/useServerNow";
import { formatClock, secondsUntil } from "../../views/auction/auctionModel";
import NumberInput from "./NumberInput";
import PrefsDialog, { type PrefsData } from "./PrefsDialog";
import RoundForm from "./RoundForm";
import RowMenu, { type RowMenuItem } from "./RowMenu";
import { emptyRound, type RoundFormValue } from "./roundFormModel";
import { adminErrorText } from "./adminShared";

type Props = { isThai: boolean; members: GuildMember[]; notify: (message: string) => void };

type Editing = { mode: "new" } | { mode: "edit"; id: number; initial: RoundFormValue };

/** Round management: create, edit drafts, start, close early, cancel, review the leftover draft, see preference lists. */
export default function AuctionAdmin({ isThai, members, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const list = usePolling(listRounds, { intervalMs: 5000, key: "admin-rounds" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<{ id: number; delay: number; duration: number } | null>(null);
  const [prefs, setPrefs] = useState<PrefsData | null>(null);
  const ignOf = (id: string) => members.find((m) => m.id === id)?.ign ?? (isThai ? "อดีตสมาชิก" : "Former member");
  const rounds = list.data ?? [];
  const hasOpen = rounds.some((r) => r.status === "open");
  const now = useServerNow(1000, hasOpen);

  /** Newest first; a leftover round sits right under the round it was made from. */
  const ids = new Set(rounds.map((r) => r.id));
  const rows = rounds
    .filter((r) => r.sourceRoundId === null || !ids.has(r.sourceRoundId))
    .flatMap((r) => {
      const child = rounds.find((c) => c.id === r.leftoverRoundId);
      return child ? [{ round: r, nested: false }, { round: child, nested: true }] : [{ round: r, nested: false }];
    });

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

  /**
   * Closed live-claim round, once: makes its leftover draft (the button is gone once one exists, and a leftover round
   * never offers it, so a round repeats a single time) — every item in the same
   * slot, the ones claimed in this round disabled — and opens it in the form for review before it is started.
   */
  async function openLeftover(round: RoundListEntry) {
    setError(null);
    setBusy(true);
    try {
      const draft = await createLeftoverDraft(round.id);
      if (draft.status === "draft") {
        await edit({ ...round, ...draft });
        notify(t(`Leftover draft #${draft.id} is ready: claimed items are disabled. Review it, then start it.`, `รอบไอเท็มที่เหลือ #${draft.id} พร้อมแล้ว ของที่ถูกจองไปถูกปิดใช้งาน ตรวจสอบแล้วกดเริ่มรอบ`));
      } else {
        notify(t(`The leftover round of #${round.id} is #${draft.id} (${statusLabel(draft.status).toLowerCase()}).`, `รอบไอเท็มที่เหลือของ #${round.id} คือ #${draft.id} (${statusLabel(draft.status)})`));
      }
    } catch (err) {
      setError(adminErrorText(err, isThai));
    } finally {
      setBusy(false);
      list.refresh();
    }
  }

  async function showPrefs(round: RoundListEntry) {
    setError(null);
    try {
      const [lists, detail] = await Promise.all([getRoundPreferences(round.id), getRound(round.id, null)]);
      setPrefs({
        roundId: round.id,
        roundName: round.name,
        closed: round.status === "closed",
        // named by slot ("P2·1" = page 2, item 1), the same numbering as the round form and the auction board
        items: (detail?.round.items ?? []).map((i, idx) => ({ id: i.id, label: t(`P${Math.floor(idx / 4) + 1}·${(idx % 4) + 1}`, `หน้า${Math.floor(idx / 4) + 1}·${(idx % 4) + 1}`), category: i.category, winnerId: i.winner?.memberId ?? null, queuePos: i.winner?.queuePos ?? null })),
        lists,
      });
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  /** Status pill; an open round adds its countdown (or "starts in" during the start delay). */
  function status(r: RoundListEntry) {
    let clock = "";
    if (r.status === "open") {
      if (r.opensAt && now < Date.parse(r.opensAt)) clock = t(`starts in ${formatClock(secondsUntil(r.opensAt, now))}`, `เริ่มใน ${formatClock(secondsUntil(r.opensAt, now))}`);
      else clock = secondsUntil(r.closesAt, now) > 0 ? formatClock(secondsUntil(r.closesAt, now)) : t("closing…", "กำลังปิด…");
    }
    return (
      <span className={`round-state ${r.status}`}>
        <span className="round-state-dot" aria-hidden="true" />
        {statusLabel(r.status)}
        {clock && <span className="round-clock">{clock}</span>}
      </span>
    );
  }

  /** Claimed out of the claimable (not disabled) items, as a bar and a count. */
  function claimed(r: RoundListEntry) {
    const pct = r.activeItemCount > 0 ? Math.round((r.claimedCount / r.activeItemCount) * 100) : 0;
    return (
      <span className="round-claimed" title={t(`${r.claimedCount} of ${r.activeItemCount} items taken (${r.itemCount - r.activeItemCount} disabled)`, `ถูกจอง ${r.claimedCount} จาก ${r.activeItemCount} ชิ้น (ปิดใช้งาน ${r.itemCount - r.activeItemCount})`)}>
        <span className="round-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        <span className="mono">{r.claimedCount}/{r.activeItemCount}</span>
      </span>
    );
  }

  function menuItems(r: RoundListEntry): RowMenuItem[] {
    const cancel: RowMenuItem = { label: t("Cancel round", "ยกเลิกรอบ"), icon: <X size={13} />, danger: true, disabled: busy, onSelect: () => void run(() => cancelRound(r.id), t("Round cancelled.", "ยกเลิกรอบแล้ว")) };
    const prefsItem: RowMenuItem = { label: t("Preference lists", "รายการจัดอันดับ"), icon: <ListOrdered size={13} />, onSelect: () => void showPrefs(r) };
    if (r.status === "draft")
      return [
        { label: t("Start…", "เริ่ม…"), icon: <Play size={13} />, disabled: busy, onSelect: () => setStarting({ id: r.id, delay: r.startDelaySec, duration: r.durationSec }) },
        { label: t("Edit", "แก้ไข"), icon: <Pencil size={13} />, disabled: busy, onSelect: () => void edit(r) },
        cancel,
      ];
    if (r.status === "open")
      return [
        { label: t("Close now", "ปิดรอบตอนนี้"), icon: <Square size={13} />, disabled: busy, onSelect: () => void run(() => closeRound(r.id), t("Round closed.", "ปิดรอบแล้ว")) },
        ...(r.type === "queueRanked" ? [prefsItem] : []),
        cancel,
      ];
    return [
      ...(r.type === "liveClaim" && r.status === "closed" && r.sourceRoundId === null && r.leftoverRoundId === null
        ? [{ label: t("Leftover draft", "รอบไอเท็มที่เหลือ"), icon: <Copy size={13} />, disabled: busy, onSelect: () => void openLeftover(r) }]
        : []),
      ...(r.type === "queueRanked" ? [prefsItem] : []),
    ];
  }

  function renderRow(r: RoundListEntry, nested: boolean) {
    return (
      <tr key={r.id} data-round={r.id} className={`${nested ? "round-nested" : ""} ${r.status === "open" ? "round-open" : ""}`}>
        <td>
          {nested && <CornerDownRight size={13} className="round-nested-icon" aria-hidden="true" />}
          <strong>#{r.id} {r.name}</strong>
          {r.sourceRoundId !== null && !nested && <em className="tag status-closed">{t(`from #${r.sourceRoundId}`, `จาก #${r.sourceRoundId}`)}</em>}
        </td>
        <td>
          <span className="round-type">
            {r.type === "liveClaim" ? <Zap size={13} /> : <ListOrdered size={13} />} {r.type === "liveClaim" ? t("Live claim", "จองสด") : t("Ranked queue", "จัดอันดับคิว")}
          </span>
        </td>
        <td>{status(r)}</td>
        <td>{claimed(r)}</td>
        <td className="row-actions">
          {starting?.id === r.id ? (
            <div className="start-panel">
              <label><span>{t("Start delay (s)", "หน่วงก่อนเริ่ม (วินาที)")}</span><NumberInput className="small-input tiny" value={starting.delay} min={0} max={60} fallback={r.startDelaySec} onChange={(delay) => setStarting((cur) => cur && { ...cur, delay })} aria-label={t("Start delay (s)", "หน่วงก่อนเริ่ม (วินาที)")} /></label>
              <label><span>{t("Duration (s)", "ระยะเวลา (วินาที)")}</span><NumberInput className="small-input" value={starting.duration} min={5} max={86400} fallback={r.durationSec} onChange={(duration) => setStarting((cur) => cur && { ...cur, duration })} aria-label={t("Duration (s)", "ระยะเวลา (วินาที)")} /></label>
              <button type="button" className="admin-button" disabled={busy} onClick={() => void run(async () => { await startRound(r.id, { startDelaySec: starting.delay, durationSec: starting.duration }); setStarting(null); }, t("Round started.", "เริ่มรอบแล้ว"), (err) => startErrorText(err, r))}><Play size={12} /> {t("Start round", "เริ่มรอบ")}</button>
              <button type="button" className="copy-button" onClick={() => setStarting(null)}>{t("Cancel", "ยกเลิก")}</button>
            </div>
          ) : (
            <RowMenu label={t(`Actions for round #${r.id}`, `คำสั่งของรอบ #${r.id}`)} items={menuItems(r)} />
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="admin-section" data-admin="auctions">
      <div className="admin-toolbar">
        <button type="button" className="admin-button" onClick={() => { setFormError(null); setEditing({ mode: "new" }); }}>
          <Plus size={13} /> {t("New round", "รอบใหม่")}
        </button>
        {list.data && <span className="occurrence-meta">{rounds.length} {t("rounds", "รอบ")}</span>}
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

      <div className="admin-table-wrap">
        <table className="admin-table round-table">
          <thead>
            <tr>
              <th>{t("Round", "รอบ")}</th>
              <th>{t("Type", "ประเภท")}</th>
              <th>{t("Status", "สถานะ")}</th>
              <th>{t("Taken", "ถูกจอง")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ round, nested }) => renderRow(round, nested))}
            {rounds.length === 0 && list.data && (
              <tr>
                <td colSpan={5} className="empty-search">{t("No rounds yet.", "ยังไม่มีรอบ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {prefs && <PrefsDialog data={prefs} isThai={isThai} ignOf={ignOf} onClose={() => setPrefs(null)} />}
    </div>
  );
}
