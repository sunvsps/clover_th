import { useState } from "react";
import type { GuildMember, Job } from "../data/guild";

type Options = {
  /** roster and jobs as loaded from the API; they seed the state */
  initialMembers: GuildMember[];
  initialJobs: Job[];
  isAdmin: boolean;
  isThai: boolean;
  notify: (message: string) => void;
};

/**
 * The roster and the job list, keyed by memberId. Both START from the API data; the job edits (`saveJobs`) are still
 * LOCAL mock state until WP15 persists them (`PUT /admin/jobs`). Team assignments live in the plan API (WP13).
 */
export function useGuildState({ initialMembers, initialJobs, isAdmin, isThai, notify }: Options) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [members] = useState<GuildMember[]>(initialMembers);

  function saveJobs(next: Job[]) {
    if (!isAdmin) return false;
    const removed = jobs.filter((job) => !next.some((entry) => entry.id === job.id));
    const stillUsed = removed.find((job) => members.some((member) => member.job === job.id));
    if (stillUsed) {
      notify(isThai ? `ลบ ${stillUsed.label} ไม่ได้ ยังมีสมาชิกใช้อยู่` : `Cannot delete ${stillUsed.label}: still in use.`);
      return false;
    }
    setJobs(next);
    notify(isThai ? "บันทึกรายการอาชีพแล้ว" : "Job list saved.");
    return true;
  }

  return { jobs, members, saveJobs };
}
