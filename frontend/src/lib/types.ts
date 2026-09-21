import type { Activity, Job, Me, Member, ScheduleEvent } from "../api";

/** Shared roster data every view needs; refreshed after admin edits. */
export type GuildData = {
  members: Member[];
  membersById: Map<string, Member>;
  jobs: Job[];
  events: ScheduleEvent[];
  activities: Activity[];
};

export type ViewProps = {
  isThai: boolean;
  me: Me;
  isAdmin: boolean;
  data: GuildData;
  notify: (message: string) => void;
  notifyError: (error: unknown) => void;
  reloadData: () => Promise<void>;
};

export const memberName = (data: GuildData, memberId: string) => data.membersById.get(memberId)?.ign ?? memberId.slice(0, 8);
