import { useEffect, useState, type FormEvent } from "react";
import { Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { deactivateMember, listAdminMembers, reactivateMember, updateMember, type AdminMember } from "../../api";
import { findJob, jobStyle, type Job } from "../../data/guild";
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
  const [search, setSearch] = useState("");
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

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    void act(() => updateMember(editing.id, { ign: editing.ign.trim(), nickname: editing.nickname.trim() || null, job: editing.job }), t("Member saved.", "บันทึกสมาชิกแล้ว"));
  };
  const closeEditor = () => {
    setEditing(null);
    setError(null);
  };

  const query = search.trim().toLowerCase();
  const list = (rows ?? []).filter((m) => !query || m.ign.toLowerCase().includes(query) || (m.nickname ?? "").toLowerCase().includes(query));
  const shownError = editing ? null : (error ?? loadError);

  return (
    <div className="admin-section" data-admin="members">
      <div className="admin-toolbar">
        <label className="team-search">
          <Search size={13} />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search...", "ค้นหาชื่อ...")} aria-label={t("Search members", "ค้นหาสมาชิก")} />
        </label>
        <label className="check"><input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} /> {t("Incomplete only", "เฉพาะข้อมูลไม่ครบ")}</label>
        <label className="check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> {t("Include deactivated", "รวมที่ปิดใช้งาน")}</label>
        <span className="occurrence-meta">{list.length} {t("members", "คน")}</span>
      </div>
      {shownError && <p className="form-error" role="alert">{shownError}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>IGN</th>
              <th>{t("Nickname", "ชื่อเล่น")}</th>
              <th>{t("Job", "อาชีพ")}</th>
              <th>Discord</th>
              <th>{t("Status", "สถานะ")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const job = findJob(jobs, m.job);
              return (
                <tr key={m.id} data-member={m.ign} className={m.isActive ? "" : "inactive"}>
                  <td>
                    <strong>{m.ign}</strong>
                    {m.isAdmin && <em className="tag admin-badge">ADMIN</em>}
                    {m.isIncomplete && <em className="tag warn">{t("Incomplete data", "ข้อมูลไม่ครบ")}</em>}
                  </td>
                  <td>{m.nickname ?? <em className="muted">{t("— incomplete", "— ไม่ครบ")}</em>}</td>
                  <td><span className="job-pill" style={jobStyle(job)}>{job?.label ?? "—"}</span></td>
                  <td className="mono">{m.discordId}</td>
                  <td>{m.isActive ? t("Active", "ใช้งาน") : t("Deactivated", "ปิดใช้งาน")}</td>
                  <td className="row-actions">
                    <button type="button" className="chip-tool" title={t("Edit", "แก้ไข")} aria-label={t("Edit", "แก้ไข")} onClick={() => { setError(null); setEditing({ id: m.id, ign: m.ign, nickname: m.nickname ?? "", job: m.job }); }}>
                      <Pencil size={11} />
                    </button>
                    {m.isActive ? (
                      <button type="button" className="chip-tool remove" disabled={busy} title={t("Deactivate", "ปิดใช้งาน")} aria-label={t("Deactivate", "ปิดใช้งาน")} onClick={() => void act(() => deactivateMember(m.id), t("Member deactivated.", "ปิดใช้งานสมาชิกแล้ว"))}>
                        <Trash2 size={11} />
                      </button>
                    ) : (
                      <button type="button" className="chip-tool" disabled={busy} title={t("Reactivate", "เปิดใช้งานอีกครั้ง")} aria-label={t("Reactivate", "เปิดใช้งานอีกครั้ง")} onClick={() => void act(() => reactivateMember(m.id), t("Member reactivated.", "เปิดใช้งานสมาชิกแล้ว"))}>
                        <RefreshCw size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows && list.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-search">{t("No members match.", "ไม่พบสมาชิก")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="page-modal-backdrop" role="presentation" onClick={closeEditor}>
          <section className="page-modal member-editor" role="dialog" aria-modal="true" aria-labelledby="member-editor-title" onClick={(e) => e.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow"><Pencil size={11} /> {t("EDIT MEMBER", "แก้ไขสมาชิก")}</p>
                <h2 id="member-editor-title">{rows?.find((m) => m.id === editing.id)?.ign ?? editing.ign}</h2>
              </div>
              <button type="button" className="modal-close" onClick={closeEditor} aria-label={t("Close", "ปิด")}>×</button>
            </div>
            <form className="editor-form" onSubmit={saveEdit}>
              <label>
                <span>{t("In-game name", "ชื่อในเกม")}</span>
                <input type="text" value={editing.ign} maxLength={40} onChange={(e) => setEditing({ ...editing, ign: e.target.value })} aria-label={t("In-game name", "ชื่อในเกม")} />
              </label>
              <label>
                <span>{t("Nickname", "ชื่อเล่น")}</span>
                <input type="text" value={editing.nickname} maxLength={40} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} aria-label={t("Nickname", "ชื่อเล่น")} />
              </label>
              <div>
                <span className="field-label" id="member-editor-job">{t("Job / card colour", "อาชีพ / สีการ์ด")}</span>
                <div className="job-picker" role="radiogroup" aria-labelledby="member-editor-job">
                  {jobs.map((j) => (
                    <button type="button" role="radio" aria-checked={editing.job === j.id} className={`job-swatch ${editing.job === j.id ? "active" : ""}`} style={jobStyle(j)} key={j.id} onClick={() => setEditing({ ...editing, job: j.id })}>
                      {j.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="editor-actions">
                <button type="button" className="copy-button" onClick={closeEditor}>{t("Cancel", "ยกเลิก")}</button>
                <button type="submit" className="admin-button" disabled={busy || !editing.ign.trim()}>{t("Save", "บันทึก")}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
