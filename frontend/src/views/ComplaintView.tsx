import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { createComplaint, isApiError } from "../api";

type Props = {
  isThai: boolean;
  notify: (message: string) => void;
};

/** The complaint tab: a small form (title + description). Only admins can see what gets filed, on the Admin page. */
export default function ComplaintView({ isThai, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems: string[] = [];
  if (!title.trim()) problems.push(t("Give the complaint a title.", "กรุณากรอกหัวเรื่อง"));
  if (!description.trim()) problems.push(t("Describe the issue.", "กรุณากรอกรายละเอียด"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await createComplaint(title.trim(), description.trim());
      setTitle("");
      setDescription("");
      notify(t("Complaint submitted.", "ส่งเรื่องร้องทุกข์แล้ว"));
    } catch (err) {
      setError(isApiError(err) ? err.userMessage(isThai) : t("Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="complaint-view">
      <form className="round-form" onSubmit={submit} aria-label={t("File a complaint", "ร้องทุกข์")}>
        <h3>{t("File a complaint", "ร้องทุกข์")}</h3>
        <label>
          <span>{t("Title", "หัวเรื่อง")}</span>
          <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label={t("Title", "หัวเรื่อง")} />
        </label>
        <label>
          <span>{t("Description", "รายละเอียด")}</span>
          <textarea value={description} maxLength={4000} rows={6} onChange={(e) => setDescription(e.target.value)} aria-label={t("Description", "รายละเอียด")} />
        </label>

        {problems.map((p) => (
          <p className="form-error" key={p} role="note">{p}</p>
        ))}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="editor-actions">
          <button type="submit" className="admin-button" disabled={busy || problems.length > 0}>
            <Send size={14} /> {t("Submit", "ส่ง")}
          </button>
        </div>
      </form>
    </div>
  );
}
