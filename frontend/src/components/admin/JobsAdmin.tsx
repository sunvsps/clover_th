import { Palette } from "lucide-react";
import { findJob, jobStyle, type GuildMember, type Job } from "../../data/guild";
import { useJobManager, type JobDraftEntry } from "../../hooks/useJobManager";
import JobManagerDialog from "../JobManagerDialog";

type Props = { isThai: boolean; jobs: Job[]; members: GuildMember[]; onSaveJobs: (next: JobDraftEntry[]) => Promise<string | null> };

/** The job list (name and card colour); the same draft-then-save manager as in the planner, saved with PUT /admin/jobs. */
export default function JobsAdmin({ isThai, jobs, members, onSaveJobs }: Props) {
  const manager = useJobManager(jobs, onSaveJobs);
  const t = (en: string, th: string) => (isThai ? th : en);
  return (
    <div className="admin-section" data-admin="jobs">
      <div className="admin-toolbar">
        <h3>{t("Jobs", "อาชีพ")}</h3>
        <button type="button" className="admin-button" onClick={manager.open}>
          <Palette size={13} /> {t("Manage jobs", "จัดการอาชีพ")}
        </button>
      </div>
      <ul className="admin-list job-summary">
        {jobs.map((j) => (
          <li key={j.id}>
            <span className="job-dot" style={jobStyle(findJob(jobs, j.id))} />
            <strong>{j.label}</strong>
            <small>{members.filter((m) => m.job === j.id).length} {t("members", "คน")}</small>
          </li>
        ))}
      </ul>
      <JobManagerDialog manager={manager} members={members} isThai={isThai} />
    </div>
  );
}
