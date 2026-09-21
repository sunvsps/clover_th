import { useEffect, useState } from "react";
import { deactivateMember, listAdminMembers, reactivateMember, updateMember, type AdminMember } from "../../api";
import type { Job } from "../../data/guild";
import { adminErrorText } from "./adminShared";

type Props = {
  isThai: boolean;
  jobs: Job[];
  /** the roster the other tools use, refreshed after a change */
  onChanged: () => void;
  notify: (message: string) => void;
};

/**
 * Members: edit ign / nickname / job, deactivate and reactivate, see who is incomplete. There is no control to add or
 * delete a member and none to grant admin: members come from the Discord bot, and admin rights are set outside the app.
 */
export default function MembersAdmin({ isThai, jobs, onChanged, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [rows, setRows] = useState<AdminMember[] | null>(null);
  const [error, setError] = useState<string | null>(null); // the last action's error (a reload must not wipe it)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; ign: string; nickname: string; job: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listAdminMembers({ incompleteOnly, includeInactive }).then(
      (list) => !cancelled && (setRows(list), setLoadError(null)),
      (err) => !cancelled && setLoadError(adminErrorText(err, isThai)),
    );
    return () => {
      cancelled = true;
    };
    // isThai only changes texts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incompleteOnly, includeInactive, reload]);

  async function act(action: () => Promise<AdminMember>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      notify(done);
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(adminErrorText(err, isThai));
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
    }
  }

  const jobLabel = (id: number) => jobs.find((j) => j.id === id)?.label ?? "—";

  return (
    <div className="admin-section" data-admin="members">
      <div className="admin-toolbar">
        <h3>{t("Members", "สมาชิก")}</h3>
        <label className="check"><input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} /> {t("Incomplete only", "เฉพาะข้อมูลไม่ครบ")}</label>
        <label className="check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> {t("Include deactivated", "รวมที่ปิดใช้งาน")}</label>
      </div>
      <p className="queue-help">{t("Members are added through the Discord bot. Here you can correct their details or deactivate them.", "สมาชิกเพิ่มผ่านบอท Discord ที่นี่แก้ไขข้อมูลหรือปิดใช้งานได้")}</p>
      {(error ?? loadError) && <p className="form-error" role="alert">{error ?? loadError}</p>}
      <ul className="admin-list">
        {(rows ?? []).map((m) => (
          <li key={m.id} data-member={m.ign} className={m.isActive ? "" : "inactive"}>
            {editing?.id === m.id ? (
              <form className="member-edit" onSubmit={(e) => { e.preventDefault(); void act(() => updateMember(m.id, { ign: editing.ign.trim(), nickname: editing.nickname.trim() || null, job: editing.job }), t("Member saved.", "บันทึกสมาชิกแล้ว")); }}>
                <label><span>{t("In-game name", "ชื่อในเกม")}</span><input value={editing.ign} maxLength={40} onChange={(e) => setEditing({ ...editing, ign: e.target.value })} aria-label={t("In-game name", "ชื่อในเกม")} /></label>
                <label><span>{t("Nickname", "ชื่อเล่น")}</span><input value={editing.nickname} maxLength={40} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} aria-label={t("Nickname", "ชื่อเล่น")} /></label>
                <label><span>{t("Job", "อาชีพ")}</span>
                  <select value={editing.job} onChange={(e) => setEditing({ ...editing, job: Number(e.target.value) })} aria-label={t("Job", "อาชีพ")}>
                    {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                  </select>
                </label>
                <button type="submit" className="admin-button" disabled={busy || !editing.ign.trim()}>{t("Save", "บันทึก")}</button>
                <button type="button" className="copy-button" onClick={() => setEditing(null)}>{t("Cancel", "ยกเลิก")}</button>
              </form>
            ) : (
              <>
                <div className="admin-row-main">
                  <strong>{m.ign}</strong>
                  <small>
                    {m.nickname ? `${m.nickname} · ` : ""}{jobLabel(m.job)}
                    {m.isAdmin && <span className="badge admin-badge"> · {t("Admin", "แอดมิน")}</span>}
                    {!m.isActive && <span className="badge"> · {t("Deactivated", "ปิดใช้งาน")}</span>}
                    {m.isIncomplete && <span className="badge warn"> · {t("Incomplete data", "ข้อมูลไม่ครบ")}</span>}
                  </small>
                </div>
                <div className="admin-row-actions">
                  <button type="button" className="copy-button" onClick={() => setEditing({ id: m.id, ign: m.ign, nickname: m.nickname ?? "", job: m.job })}>{t("Edit", "แก้ไข")}</button>
                  {m.isActive ? (
                    <button type="button" className="copy-button danger" disabled={busy} onClick={() => void act(() => deactivateMember(m.id), t("Member deactivated.", "ปิดใช้งานสมาชิกแล้ว"))}>{t("Deactivate", "ปิดใช้งาน")}</button>
                  ) : (
                    <button type="button" className="admin-button" disabled={busy} onClick={() => void act(() => reactivateMember(m.id), t("Member reactivated.", "เปิดใช้งานสมาชิกแล้ว"))}>{t("Reactivate", "เปิดใช้งานอีกครั้ง")}</button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {rows && rows.length === 0 && <p className="empty-search">{t("No members match.", "ไม่พบสมาชิก")}</p>}
    </div>
  );
}
