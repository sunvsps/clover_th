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
        <h3>{t("Notifications", "การแจ้งเตือน")}</h3>
        <select value={status} onChange={(e) => { setStatus(e.target.value as NotificationStatus | ""); setExtra([]); setCursor(undefined); }} aria-label={t("Status", "สถานะ")}>
          <option value="">{t("All statuses", "ทุกสถานะ")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        {page && <span className="plan-count">{STATUSES.map((s) => `${statusLabel(s)} ${page.counts[s]}`).join(" · ")}</span>}
      </div>
      {(error || polled.error) && <p className="form-error" role="alert">{error ?? polled.error?.userMessage(isThai)}</p>}
      <ul className="admin-list">
        {rows.map((n) => (
          <li key={n.id} data-notification={n.id} data-status={n.status}>
            <div className="admin-row-main">
              <strong>#{n.id} {n.eventType}</strong>
              <small>
                {statusLabel(n.status)} · {n.target === "dm" ? t("DM", "ข้อความส่วนตัว") : t("Channel", "ช่อง")} · {n.attempts}/{n.maxAttempts} · {bangkokStamp(n.createdAt)}
                {n.lastError && <span className="badge warn"> · {n.lastErrorCode ? `${n.lastErrorCode}: ` : ""}{n.lastError}</span>}
              </small>
            </div>
            {n.status === "dead" && (
              <div className="admin-row-actions">
                <button type="button" className="admin-button" disabled={busy === n.id} onClick={() => void retry(n)} aria-label={t(`Retry notification ${n.id}`, `ส่งการแจ้งเตือน ${n.id} ใหม่`)}>
                  <RotateCw size={12} /> {t("Retry", "ส่งใหม่")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {page && rows.length === 0 && <p className="empty-search">{t("No notifications.", "ไม่มีการแจ้งเตือน")}</p>}
      {next !== null && <button type="button" className="copy-button" onClick={() => void more()}>{t("Load more", "โหลดเพิ่ม")}</button>}
    </div>
  );
}
