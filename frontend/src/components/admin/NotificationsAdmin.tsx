import { useState } from "react";
import { RotateCw } from "lucide-react";
import { listNotifications, retryNotification, usePolling, type NotificationPage, type NotificationRow, type NotificationStatus } from "../../api";
import { adminErrorText, bangkokStamp } from "./adminShared";

type Props = { isThai: boolean; notify: (message: string) => void };

const STATUSES: NotificationStatus[] = ["pending", "sending", "sent", "dead"];

/** The outbound notification log (Discord DMs and channel posts) with a filter and a Retry for DEAD rows. */
export default function NotificationsAdmin({ isThai, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [status, setStatus] = useState<NotificationStatus | "">("");
  const [extra, setExtra] = useState<NotificationRow[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const polled = usePolling<NotificationPage>(() => listNotifications({ status: status || undefined, limit: 50 }), { intervalMs: 10_000, key: `notifications:${status}` });
  const page = polled.data;
  const rows = [...(page?.items ?? []), ...extra];
  const next = cursor === undefined ? (page?.nextCursor ?? null) : cursor;
  const statusLabel = (s: NotificationStatus) => ({ pending: t("Pending", "รอส่ง"), sending: t("Sending", "กำลังส่ง"), sent: t("Sent", "ส่งแล้ว"), dead: t("Failed", "ส่งไม่สำเร็จ") })[s];

  async function retry(n: NotificationRow) {
    setBusy(n.id);
    setError(null);
    try {
      await retryNotification(n.id);
      notify(t(`Notification #${n.id} queued to be sent again.`, `ส่งการแจ้งเตือน #${n.id} อีกครั้งแล้ว`));
    } catch (err) {
      setError(adminErrorText(err, isThai));
    } finally {
      setBusy(null);
      setExtra([]);
      setCursor(undefined);
      polled.refresh();
    }
  }

  async function more() {
    if (next === null) return;
    try {
      const p = await listNotifications({ status: status || undefined, limit: 50, cursor: next });
      setExtra((e) => [...e, ...p.items]);
      setCursor(p.nextCursor);
    } catch (err) {
      setError(adminErrorText(err, isThai));
    }
  }

  return (
    <div className="admin-section" data-admin="notifications">
      <div className="admin-toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value as NotificationStatus | ""); setExtra([]); setCursor(undefined); }} aria-label={t("Status", "สถานะ")}>
          <option value="">{t("All statuses", "ทุกสถานะ")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        {page && (
          <div className="summary-meta">
            {STATUSES.map((s) => <span key={s}>{`${statusLabel(s)} ${page.counts[s]}`}</span>)}
          </div>
        )}
      </div>
      {(error || polled.error) && <p className="form-error" role="alert">{error ?? polled.error?.userMessage(isThai)}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("Event", "เหตุการณ์")}</th>
              <th>{t("Target", "ปลายทาง")}</th>
              <th>{t("Status", "สถานะ")}</th>
              <th>{t("Attempts", "ครั้ง")}</th>
              <th>{t("Error", "ข้อผิดพลาด")}</th>
              <th>{t("Created", "สร้างเมื่อ")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} data-notification={n.id} data-status={n.status}>
                <td className="mono">#{n.id}</td>
                <td>{n.eventType}</td>
                <td>{n.target === "dm" ? t("DM", "ข้อความส่วนตัว") : t("Channel", "ช่อง")}</td>
                <td><em className={`tag status-${n.status}`}>{statusLabel(n.status)}</em></td>
                <td className="mono">{n.attempts}/{n.maxAttempts}</td>
                <td className="mono small" title={n.lastError ?? undefined}>{n.lastError ? `${n.lastErrorCode ? `${n.lastErrorCode}: ` : ""}${n.lastError}` : ""}</td>
                <td className="mono">{bangkokStamp(n.createdAt)}</td>
                <td className="row-actions">
                  {n.status === "dead" && (
                    <button type="button" className="copy-button" disabled={busy === n.id} onClick={() => void retry(n)} aria-label={t(`Retry notification ${n.id}`, `ส่งการแจ้งเตือน ${n.id} ใหม่`)}>
                      <RotateCw size={11} /> {t("Retry", "ส่งใหม่")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {page && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-search">{t("No notifications.", "ไม่มีการแจ้งเตือน")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next !== null && <button type="button" className="copy-button load-more" onClick={() => void more()}>{t("Load more", "โหลดเพิ่ม")}</button>}
    </div>
  );
}
