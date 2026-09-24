import { BarChart3 } from "lucide-react";
import type { GuildMember, Job } from "../data/guild";
import JobChart from "./JobChart";

type Props = {
  jobs: Job[];
  members: GuildMember[];
  assignments: Record<string, string>;
  isThai: boolean;
};

/** "Members per job" card of the team planner: title, member count and the bar chart. Job names/colors are managed from Admin > Jobs. */
export default function JobChartCard({ jobs, members, assignments, isThai }: Props) {
  return (
    <div className="chart-card">
      <div className="pool-title">
        <strong>
          <BarChart3 size={14} /> {isThai ? "จำนวนสมาชิกแต่ละอาชีพ" : "Members per job"}
        </strong>
        <span className="chart-card-meta">
          {members.length} {isThai ? "คน" : "members"}
        </span>
      </div>
      <JobChart jobs={jobs} members={members} assignments={assignments} isThai={isThai} />
    </div>
  );
}
