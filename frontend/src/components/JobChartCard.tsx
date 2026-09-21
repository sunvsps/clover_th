import { BarChart3, Pencil } from "lucide-react";
import type { GuildMember, Job } from "../data/guild";
import JobChart from "./JobChart";

type Props = {
  jobs: Job[];
  members: GuildMember[];
  assignments: Record<string, string>;
  isThai: boolean;
  canEdit: boolean;
  onEditJobs: () => void;
};

/** "Members per job" card of the team planner: title, member count, the bar chart, and the admin "Edit jobs" link. */
export default function JobChartCard({ jobs, members, assignments, isThai, canEdit, onEditJobs }: Props) {
  return (
    <div className="chart-card">
      <div className="pool-title">
        <strong>
          <BarChart3 size={14} /> {isThai ? "จำนวนสมาชิกแต่ละอาชีพ" : "Members per job"}
        </strong>
        <span className="chart-card-meta">
          {members.length} {isThai ? "คน" : "members"}
          {canEdit && (
            <button type="button" className="inline-edit-button" onClick={onEditJobs}>
              <Pencil size={11} /> {isThai ? "แก้ชื่อ / สีอาชีพ" : "Edit jobs"}
            </button>
          )}
        </span>
      </div>
      <JobChart jobs={jobs} members={members} assignments={assignments} isThai={isThai} />
    </div>
  );
}
