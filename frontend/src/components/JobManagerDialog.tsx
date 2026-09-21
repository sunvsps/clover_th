import { Check, Palette, Plus, Trash2 } from "lucide-react";
import { jobStyle, type GuildMember } from "../data/guild";
import type { JobManager } from "../hooks/useJobManager";

type Props = {
  manager: JobManager;
  members: GuildMember[];
  isThai: boolean;
};

/** Modal to rename jobs, recolour them, add new ones and delete unused ones (admin only, applied on Save). */
export default function JobManagerDialog({ manager, members, isThai }: Props) {
  const { jobDraft } = manager;
  if (!jobDraft) return null;

  return (
    <div className="page-modal-backdrop" role="presentation" onClick={manager.close}>
      <section
        className="page-modal job-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-manager-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="page-modal-header">
          <div>
            <p className="eyebrow">
              <Palette size={11} /> {isThai ? "แอดมิน: จัดการอาชีพ" : "ADMIN: MANAGE JOBS"}
            </p>
            <h2 id="job-manager-title">{isThai ? "อาชีพและสีการ์ด" : "Jobs & card colours"}</h2>
            <small className="event-dialog-status">
              {isThai
                ? "แก้ชื่อหรือสีแล้วกดบันทึก ลบได้เฉพาะอาชีพที่ไม่มีสมาชิกใช้"
                : "Edit names or colours, then press Save. Only unused jobs can be deleted."}
            </small>
          </div>
          <button type="button" className="modal-close" onClick={manager.close} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="job-list">
          {jobDraft.map((job) => {
            const used = members.filter((member) => member.job === job.id).length;
            const duplicate = jobDraft.some(
              (other) =>
                other.id !== job.id &&
                other.label.trim().toLowerCase() === job.label.trim().toLowerCase() &&
                job.label.trim(),
            );
            return (
              <li key={job.id} className={duplicate || !job.label.trim() ? "invalid" : ""}>
                <label className="color-well" style={jobStyle(job)} title={isThai ? "เลือกสี" : "Pick colour"}>
                  <input
                    type="color"
                    value={job.color}
                    onChange={(event) => manager.patchDraft(job.id, { color: event.target.value })}
                    aria-label={`${job.label} colour`}
                  />
                </label>
                <input
                  type="text"
                  value={job.label}
                  maxLength={30}
                  placeholder={isThai ? "ชื่ออาชีพ" : "Job name"}
                  onChange={(event) => manager.patchDraft(job.id, { label: event.target.value })}
                  aria-label="Job name"
                />
                <span className="job-count">
                  {used} {isThai ? "คน" : ""}
                </span>
                <button
                  type="button"
                  className="chip-tool remove"
                  disabled={used > 0}
                  title={used > 0 ? (isThai ? "ยังมีสมาชิกใช้อาชีพนี้" : "Still in use") : isThai ? "ลบอาชีพ" : "Delete job"}
                  aria-label={isThai ? "ลบอาชีพ" : "Delete job"}
                  onClick={() => manager.removeDraftJob(job.id)}
                >
                  <Trash2 size={11} />
                </button>
              </li>
            );
          })}
        </ul>
        <form className="job-add" onSubmit={manager.addDraftJob}>
          <label
            className="color-well"
            style={jobStyle({ id: 0, label: "", color: manager.newJobColor })}
            title={isThai ? "เลือกสี" : "Pick colour"}
          >
            <input
              type="color"
              value={manager.newJobColor}
              onChange={(event) => manager.setNewJobColor(event.target.value)}
              aria-label={isThai ? "สีอาชีพใหม่" : "New job colour"}
            />
          </label>
          <input
            type="text"
            value={manager.newJobLabel}
            maxLength={30}
            placeholder={isThai ? "ชื่ออาชีพใหม่" : "New job name"}
            onChange={(event) => manager.setNewJobLabel(event.target.value)}
          />
          <button type="submit" className="copy-button" disabled={!manager.newJobLabel.trim()}>
            <Plus size={13} /> {isThai ? "เพิ่มในรายการ" : "Add to list"}
          </button>
        </form>
        <div className="editor-actions">
          {!manager.draftValid && (
            <span className="form-error">
              {isThai ? "ชื่ออาชีพต้องไม่ว่างและไม่ซ้ำกัน" : "Job names must be filled in and unique."}
            </span>
          )}
          <button type="button" className="copy-button" onClick={manager.close}>
            {isThai ? "ยกเลิก" : "Cancel"}
          </button>
          <button type="button" className="admin-button" disabled={!manager.draftValid} onClick={manager.save}>
            <Check size={13} /> {isThai ? "บันทึก" : "Save"}
          </button>
        </div>
      </section>
    </div>
  );
}
