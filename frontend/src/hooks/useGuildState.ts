import { useState } from "react";
import { isApiError, saveJobs as saveJobsApi, type WireActivity } from "../api";
import type { GuildMember, Job } from "../data/guild";
import type { JobDraftEntry } from "./useJobManager";

type Options = {
  /** loaded from the API; they seed the state, and the admin page keeps them current after each change */
  initialMembers: GuildMember[];
  initialJobs: Job[];
  initialActivities: WireActivity[];
  isThai: boolean;
  notify: (message: string) => void;
};

/**
 * The roster, the job list and the activities that the tools share, keyed by memberId. They start from the API data
 * and are replaced with the server's answer after every admin change (nothing is edited only locally any more).
 */
export function useGuildState({ initialMembers, initialJobs, initialActivities, isThai, notify }: Options) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [members, setMembers] = useState<GuildMember[]>(initialMembers);
  const [activities, setActivities] = useState<WireActivity[]>(initialActivities);

  /** `PUT /admin/jobs`; returns an error text for the job manager to show, or null when saved. */
  async function saveJobs(next: JobDraftEntry[]): Promise<string | null> {
    try {
      setJobs(await saveJobsApi(next));
      notify(isThai ? "บันทึกรายการอาชีพแล้ว" : "Job list saved.");
      return null;
    } catch (err) {
      if (isApiError(err) && err.code === "JOB_IN_USE") {
        const ids = (err.details.jobIds as number[] | undefined) ?? [];
        const labels = jobs.filter((j) => ids.includes(j.id)).map((j) => j.label).join(", ");
        return isThai ? `ลบไม่ได้ ยังมีสมาชิกใช้อาชีพ: ${labels}` : `Cannot delete ${labels}: members still use it.`;
      }
      return isApiError(err) ? err.userMessage(isThai) : isThai ? "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" : "Something went wrong. Please try again.";
    }
  }

  const updateActivity = (activity: WireActivity) => setActivities((list) => list.map((a) => (a.id === activity.id ? activity : a)));

  return { jobs, members, activities, saveJobs, setMembers, setJobs, updateActivity };
}
