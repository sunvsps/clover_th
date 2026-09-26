import { useEffect, useState } from "react";
import { listAudit, type AuditRow } from "../../api";
import type { GuildMember } from "../../data/guild";
import { adminErrorText, bangkokStamp } from "./adminShared";

type Props = { isThai: boolean; members: GuildMember[] };

/** Read-only audit log: newest first, filter by actor and action, "Load more" pages with the cursor. */
export default function AuditAdmin({ isThai, members }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [actor, setActor] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.ign ?? id.slice(0, 8)) : "—");

  useEffect(() => {
    let cancelled = false;
    listAudit({ actor: actor || undefined, action: action || undefined, limit: 50 }).then(
      (p) => !cancelled && (setRows(p.items), setCursor(p.nextCursor), setLoaded(true), setError(null)),
      (err) => !cancelled && setError(adminErrorText(err, isThai)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, action]);

  async function more() {
    if (cursor === null) return;
    try {
      const p = await listAudit({ actor: actor || undefined, action: action || undefined, limit: 50, cursor });
      setRows((r) => [...r, ...p.items]);
      setCursor(p.nextCursor);
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  return (
    <div className="admin-section" data-admin="audit">
      <div className="admin-toolbar">
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t("Actor", "ผู้ทำรายการ")}>
          <option value="">{t("Any actor", "ทุกคน")}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
        </select>
        <form className="admin-filter" onSubmit={(e) => { e.preventDefault(); setAction(actionInput.trim()); }}>
          <input className="small-input wide" value={actionInput} placeholder={t("Action, e.g. plan.place", "การกระทำ เช่น plan.place")} onChange={(e) => setActionInput(e.target.value)} aria-label={t("Action", "การกระทำ")} />
          <button type="submit" className="copy-button">{t("Filter", "กรอง")}</button>
        </form>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Time", "เวลา")}</th>
              <th>{t("Actor", "ผู้กระทำ")}</th>
              <th>{t("Action", "การกระทำ")}</th>
              <th>{t("Entity", "เป้าหมาย")}</th>
              <th>{t("Details", "รายละเอียด")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} data-audit={a.id}>
                <td className="mono">{bangkokStamp(a.at)}</td>
                <td>{a.actorType === "member" ? ignOf(a.actorId) : a.actorType}</td>
                <td className="mono">{a.action}</td>
                <td className="mono">{a.entityType} {a.entityId}</td>
                <td className="mono small" title={a.meta !== null && a.meta !== undefined ? JSON.stringify(a.meta, null, 2) : undefined}>
                  {a.meta !== null && a.meta !== undefined ? JSON.stringify(a.meta).slice(0, 120) : ""}
                </td>
              </tr>
            ))}
            {loaded && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-search">{t("No entries.", "ไม่มีรายการ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor !== null && <button type="button" className="copy-button load-more" onClick={() => void more()}>{t("Load more", "โหลดเพิ่ม")}</button>}
    </div>
  );
}
