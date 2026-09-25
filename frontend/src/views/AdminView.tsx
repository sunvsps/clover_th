import { useState } from "react";
import { Shield } from "lucide-react";
import type { WireActivity } from "../api";
import ActivitiesAdmin from "../components/admin/ActivitiesAdmin";
import AuctionAdmin from "../components/admin/AuctionAdmin";
import AuditAdmin from "../components/admin/AuditAdmin";
import ComplaintsAdmin from "../components/admin/ComplaintsAdmin";
import JobsAdmin from "../components/admin/JobsAdmin";
import LayoutAdmin from "../components/admin/LayoutAdmin";
import MembersAdmin from "../components/admin/MembersAdmin";
import NotificationsAdmin from "../components/admin/NotificationsAdmin";
import type { GuildMember, Job } from "../data/guild";
import type { JobDraftEntry } from "../hooks/useJobManager";

type Props = {
  isThai: boolean;
  jobs: Job[];
  members: GuildMember[];
  activities: WireActivity[];
  onSaveJobs: (next: JobDraftEntry[]) => Promise<string | null>;
  onMembersChanged: () => void;
  onActivityChanged: (activity: WireActivity) => void;
  notify: (message: string) => void;
};

type Tab = "auctions" | "members" | "activities" | "layout" | "jobs" | "notifications" | "complaints" | "audit";

/**
 * The admin page (only rendered for admins; the server still enforces every call). It has no control to grant admin
 * rights or to add or delete a member.
 */
export default function AdminView({ isThai, jobs, members, activities, onSaveJobs, onMembersChanged, onActivityChanged, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [tab, setTab] = useState<Tab>("auctions");
  const tabs: [Tab, string][] = [
    ["auctions", t("Auctions", "ประมูล")],
    ["members", t("Members", "สมาชิก")],
    ["activities", t("Activities", "กิจกรรม")],
    ["layout", t("Team layout", "โครงสร้างทีม")],
    ["jobs", t("Jobs", "อาชีพ")],
    ["notifications", t("Notifications", "การแจ้งเตือน")],
    ["complaints", t("Complaints", "ร้องเรียน")],
    ["audit", t("Audit log", "บันทึกการทำงาน")],
  ];
  return (
    <section className="feature-page admin-page" data-testid="admin-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow"><Shield size={13} /> ADMIN</p>
          <h2>{t("Admin", "แอดมิน")}</h2>
        </div>
      </div>
      <div className="auction-tabs admin-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "auctions" && <AuctionAdmin isThai={isThai} members={members} notify={notify} />}
      {tab === "members" && <MembersAdmin isThai={isThai} jobs={jobs} onChanged={onMembersChanged} notify={notify} />}
      {tab === "activities" && <ActivitiesAdmin isThai={isThai} activities={activities} onChanged={onActivityChanged} notify={notify} />}
      {tab === "layout" && <LayoutAdmin isThai={isThai} activities={activities} onChanged={() => {}} notify={notify} />}
      {tab === "jobs" && <JobsAdmin isThai={isThai} jobs={jobs} members={members} onSaveJobs={onSaveJobs} />}
      {tab === "notifications" && <NotificationsAdmin isThai={isThai} notify={notify} />}
      {tab === "complaints" && <ComplaintsAdmin isThai={isThai} />}
      {tab === "audit" && <AuditAdmin isThai={isThai} members={members} />}
    </section>
  );
}
