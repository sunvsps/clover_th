import { getAdminComplaints, usePolling } from "../../api";
import { bangkokStamp } from "./adminShared";

type Props = { isThai: boolean };

/** Read-only: every complaint filed by any member, newest first. Only admins can reach this (server enforced too). */
export default function ComplaintsAdmin({ isThai }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const polled = usePolling((signal) => getAdminComplaints(signal), { intervalMs: 15_000, key: "admin-complaints" });
  const rows = polled.data ?? [];

  return (
    <div className="admin-section" data-admin="complaints">
      <div className="admin-toolbar">
        <h3>{t("Complaints", "ร้องเรียน")}</h3>
      </div>
      {polled.error && <p className="form-error" role="alert">{polled.error.userMessage(isThai)}</p>}
      <ul className="admin-list">
        {rows.map((c) => (
          <li key={c.id} data-complaint={c.id}>
            <div className="admin-row-main">
              <strong>{c.title}</strong>
              <small>{c.memberIgn} · {bangkokStamp(c.createdAt)}</small>
              <p>{c.description}</p>
            </div>
          </li>
        ))}
      </ul>
      {polled.data && rows.length === 0 && <p className="empty-search">{t("No complaints filed yet.", "ยังไม่มีเรื่องร้องเรียน")}</p>}
    </div>
  );
}
