import { useState } from "react";
import { updateActivity, type WireActivity } from "../../api";
import { adminErrorText } from "./adminShared";

type Props = {
  isThai: boolean;
  activities: WireActivity[];
  onChanged: (activity: WireActivity) => void;
  notify: (message: string) => void;
};

type Draft = { capacity: string; autoBackfill: boolean; channel: string };

/** Per-activity settings: registration capacity (empty = no limit), auto-backfill (planner activities) and the notification channel. */
export default function ActivitiesAdmin({ isThai, activities, onChanged, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const baseOf = (a: WireActivity): Draft => ({ capacity: a.registrationCapacity === null ? "" : String(a.registrationCapacity), autoBackfill: a.autoBackfill, channel: a.notifyChannelId ?? "" });
  const draftOf = (a: WireActivity): Draft => drafts[a.id] ?? baseOf(a);
  const patch = (a: WireActivity, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [a.id]: { ...(d[a.id] ?? baseOf(a)), ...p } }));

  async function save(a: WireActivity) {
    const d = draftOf(a);
    setBusy(a.id);
    setErrors((e) => ({ ...e, [a.id]: "" }));
    try {
      const res = await updateActivity(a.id, {
        registrationCapacity: d.capacity.trim() === "" ? null : Number(d.capacity),
        autoBackfill: d.autoBackfill,
        notifyChannelId: d.channel.trim() === "" ? null : d.channel.trim(),
      });
      onChanged(res.activity);
      setDrafts((all) => {
        const next = { ...all };
        delete next[a.id];
        return next;
      });
      notify(
        res.promoted.length > 0
          ? t(`${a.name} saved. ${res.promoted.length} waitlisted members were moved up.`, `บันทึก ${a.name} แล้ว ${res.promoted.length} คนจากคิวสำรองได้เลื่อนขึ้น`)
          : t(`${a.name} saved.`, `บันทึก ${a.name} แล้ว`),
      );
    } catch (err) {
      setErrors((e) => ({ ...e, [a.id]: adminErrorText(err, isThai) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-section" data-admin="activities">
      <h3>{t("Activity settings", "ตั้งค่ากิจกรรม")}</h3>
      <ul className="admin-list">
        {activities.map((a) => {
          const d = draftOf(a);
          const capBad = d.capacity.trim() !== "" && (!Number.isInteger(Number(d.capacity)) || Number(d.capacity) < 1);
          return (
            <li key={a.id} data-activity={a.id}>
              <div className="admin-row-main">
                <strong>{a.name}</strong>
                <small>{a.hasPlanner ? t(`Team planner · ${a.layoutCapacity} slots`, `จัดทีมได้ · ${a.layoutCapacity} ช่อง`) : t("No team planner", "ไม่มีการจัดทีม")}</small>
              </div>
              <div className="settings-grid">
                <label><span>{t("Capacity (empty = no limit)", "จำนวนที่รับ (ว่าง = ไม่จำกัด)")}</span>
                  <input type="number" min={1} value={d.capacity} onChange={(e) => patch(a, { capacity: e.target.value })} aria-label={t(`${a.name} capacity`, `จำนวนที่รับของ ${a.name}`)} aria-invalid={capBad} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={d.autoBackfill} disabled={!a.hasPlanner} onChange={(e) => patch(a, { autoBackfill: e.target.checked })} aria-label={t(`${a.name} auto-backfill`, `เติมช่องอัตโนมัติของ ${a.name}`)} />
                  {t("Auto-backfill from reserves", "เติมช่องจากสำรองอัตโนมัติ")}
                  {!a.hasPlanner && <small> ({t("needs a team planner", "ต้องมีการจัดทีม")})</small>}
                </label>
                <label><span>{t("Notification channel id", "ไอดีช่องแจ้งเตือน")}</span>
                  <input type="text" value={d.channel} maxLength={32} onChange={(e) => patch(a, { channel: e.target.value })} aria-label={t(`${a.name} notification channel`, `ช่องแจ้งเตือนของ ${a.name}`)} />
                </label>
                <button type="button" className="admin-button" disabled={busy === a.id || capBad || !drafts[a.id]} onClick={() => void save(a)} aria-label={t(`Save ${a.name}`, `บันทึก ${a.name}`)}>{t("Save", "บันทึก")}</button>
              </div>
              {errors[a.id] && <p className="form-error" role="alert">{errors[a.id]}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
