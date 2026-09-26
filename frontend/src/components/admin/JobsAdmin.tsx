import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { jobStyle, type GuildMember, type Job } from "../../data/guild";
import type { JobDraftEntry } from "../../hooks/useJobManager";

type Props = {
  isThai: boolean;
  jobs: Job[];
  members: GuildMember[];
  /** calls PUT /admin/jobs; resolves to an error text (the draft stays) or null on success (it notifies itself) */
  onSaveJobs: (next: JobDraftEntry[]) => Promise<string | null>;
};

type DraftJob = JobDraftEntry & { key: string };

/**
 * The job list (name and card colour), edited in place and applied with one Save. Only a job no member uses can be
 * removed. The parent remounts this (keyed on the job list) after a save, so the draft restarts from the new list.
 */
export default function JobsAdmin({ isThai, jobs, members, onSaveJobs }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [draft, setDraft] = useState<DraftJob[]>(() => jobs.map((j) => ({ id: j.id, label: j.label, color: j.color, key: `job-${j.id}` })));
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6c8cff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labels = draft.map((j) => j.label.trim().toLowerCase());
  const valid = labels.every(Boolean) && new Set(labels).size === labels.length;
  const usedBy = (id: number | undefined) => (id === undefined ? 0 : members.filter((m) => m.job === id).length);
  const patchJob = (key: string, patch: Partial<DraftJob>) => setDraft((d) => d.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  async function save() {
    setBusy(true);
    setError(null);
    const failure = await onSaveJobs(draft.map((j) => ({ id: j.id, label: j.label.trim(), color: j.color })));
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <div className="admin-section job-manager-inline" data-admin="jobs">
      <p className="occurrence-meta">{t("Edit names or colours, then Save. Only unused jobs can be deleted.", "แก้ชื่อหรือสีแล้วกดบันทึก ลบได้เฉพาะอาชีพที่ไม่มีสมาชิกใช้")}</p>
      <ul className="job-list">
        {draft.map((job) => {
          const used = usedBy(job.id);
          const duplicate = !!job.label.trim() && labels.filter((l) => l === job.label.trim().toLowerCase()).length > 1;
          return (
            <li key={job.key} className={duplicate || !job.label.trim() ? "invalid" : ""}>
              <label className="color-well" style={jobStyle({ id: 0, label: job.label, color: job.color })} title={t("Pick colour", "เลือกสี")}>
                <input type="color" value={job.color} onChange={(e) => patchJob(job.key, { color: e.target.value })} aria-label={`${job.label} colour`} />
              </label>
              <input type="text" value={job.label} maxLength={30} placeholder={t("Job name", "ชื่ออาชีพ")} onChange={(e) => patchJob(job.key, { label: e.target.value })} aria-label="Job name" />
              <span className="job-count">{used > 0 ? `${used} ${t("in use", "คน")}` : ""}</span>
              <button
                type="button"
                className="chip-tool remove"
                disabled={used > 0}
                title={used > 0 ? t("Still in use", "ยังมีสมาชิกใช้อาชีพนี้") : t("Delete job", "ลบอาชีพ")}
                aria-label={t("Delete job", "ลบอาชีพ")}
                onClick={() => setDraft((d) => d.filter((j) => j.key !== job.key))}
              >
                <Trash2 size={11} />
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="job-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newLabel.trim()) return;
          setDraft((d) => [...d, { label: newLabel.trim(), color: newColor, key: `new-${Date.now()}-${d.length}` }]);
          setNewLabel("");
        }}
      >
        <label className="color-well" style={jobStyle({ id: 0, label: "", color: newColor })} title={t("Pick colour", "เลือกสี")}>
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} aria-label={t("New job colour", "สีอาชีพใหม่")} />
        </label>
        <input type="text" value={newLabel} maxLength={30} placeholder={t("New job name", "ชื่ออาชีพใหม่")} onChange={(e) => setNewLabel(e.target.value)} />
        <button type="submit" className="copy-button" disabled={!newLabel.trim()}>
          <Plus size={13} /> {t("Add to list", "เพิ่มในรายการ")}
        </button>
      </form>
      <div className="editor-actions">
        {error && <span className="form-error" role="alert">{error}</span>}
        {!valid && <span className="form-error">{t("Job names must be filled in and unique.", "ชื่ออาชีพต้องไม่ว่างและไม่ซ้ำกัน")}</span>}
        <button type="button" className="admin-button" disabled={!valid || busy} onClick={() => void save()}>
          <Check size={13} /> {t("Save", "บันทึก")}
        </button>
      </div>
    </div>
  );
}
