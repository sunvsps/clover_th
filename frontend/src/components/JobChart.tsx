import { useState } from "react";
import { jobStyle, type GuildMember, type Job } from "../data/guild";

type Props = {
  jobs: Job[];
  members: GuildMember[];
  assignments: Record<string, string>;
  isThai: boolean;
};

/** Horizontal bar per job: members already placed in a subteam (solid) + still unassigned (tint). */
export default function JobChart({ jobs, members, assignments, isThai }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const rows = jobs.map((job) => {
    const ofJob = members.filter((member) => member.job === job.id);
    const inTeam = ofJob.filter((member) => assignments[member.name]).length;
    return { job, total: ofJob.length, inTeam, free: ofJob.length - inTeam };
  });
  const max = Math.max(1, ...rows.map((row) => row.total));
  const inTeamLabel = isThai ? "อยู่ในทีมแล้ว" : "In a subteam";
  const freeLabel = isThai ? "ยังไม่มีทีม" : "Unassigned";

  return (
    <div className="job-chart">
      <div className="chart-legend">
        <span>
          <i className="legend-swatch solid" /> {inTeamLabel}
        </span>
        <span>
          <i className="legend-swatch tint" /> {freeLabel}
        </span>
      </div>
      <div className="chart-rows" role="img" aria-label={isThai ? "กราฟจำนวนสมาชิกแต่ละอาชีพ" : "Members per job chart"}>
        {rows.map(({ job, total, inTeam, free }) => (
          <div
            className={`chart-row ${hovered === job.id ? "hovered" : ""}`}
            key={job.id}
            onMouseEnter={() => setHovered(job.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="chart-label">
              <i className="job-dot" style={jobStyle(job)} />
              <span>{job.label}</span>
            </span>
            <span className="chart-track">
              {inTeam > 0 && <i className="chart-seg solid" style={{ ...jobStyle(job), width: `${(inTeam / max) * 100}%` }} />}
              {free > 0 && <i className="chart-seg tint" style={{ ...jobStyle(job), width: `${(free / max) * 100}%` }} />}
              {hovered === job.id && (
                <span className="chart-tooltip" role="tooltip">
                  <strong>{job.label}</strong>
                  <span>
                    {inTeamLabel}: {inTeam}
                  </span>
                  <span>
                    {freeLabel}: {free}
                  </span>
                </span>
              )}
            </span>
            <span className="chart-value">{total}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{isThai ? "จำนวนสมาชิกแต่ละอาชีพ" : "Members per job"}</caption>
        <thead>
          <tr>
            <th>{isThai ? "อาชีพ" : "Job"}</th>
            <th>{inTeamLabel}</th>
            <th>{freeLabel}</th>
            <th>{isThai ? "รวม" : "Total"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, total, inTeam, free }) => (
            <tr key={job.id}>
              <td>{job.label}</td>
              <td>{inTeam}</td>
              <td>{free}</td>
              <td>{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
