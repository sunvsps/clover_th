import { useState, type ReactNode } from "react";
import { Activity, Bell, Gavel, LayoutGrid, ListOrdered, MessageSquareWarning, Palette, ScrollText, Settings, UserCog } from "lucide-react";
import type { WireActivity } from "../api";
import ActivitiesAdmin from "../components/admin/ActivitiesAdmin";
import AuctionAdmin from "../components/admin/AuctionAdmin";
import AuditAdmin from "../components/admin/AuditAdmin";
import ComplaintsAdmin from "../components/admin/ComplaintsAdmin";
import JobsAdmin from "../components/admin/JobsAdmin";
import LayoutAdmin from "../components/admin/LayoutAdmin";
import MembersAdmin from "../components/admin/MembersAdmin";
import NotificationsAdmin from "../components/admin/NotificationsAdmin";
import QueuesAdmin from "../components/admin/QueuesAdmin";
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

type Tab = "auctions" | "queues" | "members" | "jobs" | "activities" | "layout" | "complaints" | "notifications" | "audit";

/**
 * The admin page (only rendered for admins; the server still enforces every call). It has no control to grant admin
 * rights or to add or delete a member.
 */
export default function AdminView({ isThai, jobs, members, activities, onSaveJobs, onMembersChanged, onActivityChanged, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [tab, setTab] = useState<Tab>("auctions");
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "auctions", label: t("Auctions", "ประมูล"), icon: <Gavel size={14} /> },
    { id: "queues", label: t("Queues", "คิวประมูล"), icon: <ListOrdered size={14} /> },
    { id: "members", label: t("Members", "สมาชิก"), icon: <UserCog size={14} /> },
    { id: "jobs", label: t("Jobs", "อาชีพ"), icon: <Palette size={14} /> },
    { id: "activities", label: t("Activities", "กิจกรรม"), icon: <Activity size={14} /> },
    { id: "layout", label: t("Team layout", "ผังทีม"), icon: <LayoutGrid size={14} /> },
    { id: "complaints", label: t("Complaints", "ร้องเรียน"), icon: <MessageSquareWarning size={14} /> },
    { id: "notifications", label: t("Notifications", "การแจ้งเตือน"), icon: <Bell size={14} /> },
    { id: "audit", label: t("Audit log", "ประวัติระบบ"), icon: <ScrollText size={14} /> },
  ];
  return (
    <section className="feature-page admin-page" data-testid="admin-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow"><Settings size={13} /> ADMIN MENU / CONFIG</p>
          <h2>{t("Admin config", "ตั้งค่าแอดมิน")}</h2>
          <p>
            {t(
              "Members come from the Discord bot only (no add or admin-grant here). Run auctions, edit names and jobs, deactivate, and configure activities and layouts here.",
              "สมาชิกมาจากบอท Discord เท่านั้น (เพิ่ม/ให้สิทธิ์แอดมินไม่ได้จากหน้านี้) จัดรอบประมูล แก้ชื่อ อาชีพ ปิดใช้งาน ตั้งค่ากิจกรรม และผังทีมได้ที่นี่",
            )}
          </p>
        </div>
      </div>
      <div className="admin-tabs" role="tablist">
        {tabs.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>
            {entry.icon} {entry.label}
          </button>
        ))}
      </div>
      {tab === "auctions" && <AuctionAdmin isThai={isThai} members={members} notify={notify} />}
      {tab === "queues" && <QueuesAdmin isThai={isThai} members={members} jobs={jobs} notify={notify} />}
      {tab === "members" && <MembersAdmin isThai={isThai} jobs={jobs} onChanged={onMembersChanged} notify={notify} />}
      {tab === "jobs" && <JobsAdmin key={jobs.map((j) => `${j.id}:${j.label}:${j.color}`).join("|")} isThai={isThai} jobs={jobs} members={members} onSaveJobs={onSaveJobs} />}
      {tab === "activities" && <ActivitiesAdmin isThai={isThai} activities={activities} onChanged={onActivityChanged} notify={notify} />}
      {tab === "layout" && <LayoutAdmin isThai={isThai} activities={activities} onChanged={() => {}} notify={notify} />}
      {tab === "complaints" && <ComplaintsAdmin isThai={isThai} />}
      {tab === "notifications" && <NotificationsAdmin isThai={isThai} notify={notify} />}
      {tab === "audit" && <AuditAdmin isThai={isThai} members={members} />}
    </section>
  );
}
