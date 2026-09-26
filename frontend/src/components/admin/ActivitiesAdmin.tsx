import { useState } from "react";
import { Check } from "lucide-react";
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
      {Object.entries(errors).filter(([, text]) => text).map(([id, text]) => (
        <p className="form-error" role="alert" key={id}>{activities.find((a) => a.id === id)?.name}: {text}</p>
      ))}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Activity", "กิจกรรม")}</th>
              <th>{t("Capacity (blank = unlimited)", "รับสูงสุด (ว่าง = ไม่จำกัด)")}</th>
              <th>{t("Planner", "จัดทีม")}</th>
              <th>{t("Auto-backfill", "เลื่อนสำรองอัตโนมัติ")}</th>
              <th>{t("Notify channel id", "Channel แจ้งเตือน")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => {
              const d = draftOf(a);
              const capBad = d.capacity.trim() !== "" && (!Number.isInteger(Number(d.capacity)) || Number(d.capacity) < 1);
              return (
                <tr key={a.id} data-activity={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                    {a.isGuild && <em className="tag">GUILD</em>}
                  </td>
                  <td>
                    <input className="small-input" type="number" min={1} value={d.capacity} placeholder="—" onChange={(e) => patch(a, { capacity: e.target.value })} aria-label={t(`${a.name} capacity`, `จำนวนที่รับของ ${a.name}`)} aria-invalid={capBad} />
                  </td>
                  <td>{a.hasPlanner ? t(`yes · ${a.layoutCapacity} slots`, `มี · ${a.layoutCapacity} ช่อง`) : "—"}</td>
                  <td>
                    <label className="check" title={a.hasPlanner ? undefined : t("needs a team planner", "ต้องมีการจัดทีม")}>
                      <input type="checkbox" checked={d.autoBackfill} disabled={!a.hasPlanner} onChange={(e) => patch(a, { autoBackfill: e.target.checked })} aria-label={t(`${a.name} auto-backfill`, `เติมช่องอัตโนมัติของ ${a.name}`)} />
                      {!a.hasPlanner && <small className="muted">{t("needs a team planner", "ต้องมีการจัดทีม")}</small>}
                    </label>
                  </td>
                  <td>
                    <input className="small-input wide" type="text" value={d.channel} maxLength={32} placeholder="—" onChange={(e) => patch(a, { channel: e.target.value })} aria-label={t(`${a.name} notification channel`, `ช่องแจ้งเตือนของ ${a.name}`)} />
                  </td>
                  <td className="row-actions">
                    <button type="button" className="admin-button" disabled={busy === a.id || capBad || !drafts[a.id]} onClick={() => void save(a)} aria-label={t(`Save ${a.name}`, `บันทึก ${a.name}`)}>
                      <Check size={12} /> {t("Save", "บันทึก")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
