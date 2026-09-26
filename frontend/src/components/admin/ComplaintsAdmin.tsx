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
      {polled.error && <p className="form-error" role="alert">{polled.error.userMessage(isThai)}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Time", "เวลา")}</th>
              <th>{t("Member", "สมาชิก")}</th>
              <th>{t("Title", "หัวข้อ")}</th>
              <th>{t("Details", "รายละเอียด")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} data-complaint={c.id}>
                <td className="mono">{bangkokStamp(c.createdAt)}</td>
                <td>{c.memberIgn}</td>
                <td><strong>{c.title}</strong></td>
                <td className="complaint-text">{c.description}</td>
              </tr>
            ))}
            {polled.data && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-search">{t("No complaints filed yet.", "ยังไม่มีเรื่องร้องเรียน")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
