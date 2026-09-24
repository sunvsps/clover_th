import { CalendarDays, Check, ListOrdered, Package, Shield, Users, X } from "lucide-react";
import { getMembers, type GuildData } from "../api";
import WeeklySchedule from "../components/WeeklySchedule";
import TeamPlanner from "../components/TeamPlanner";
import { useGuildState } from "../hooks/useGuildState";
import { useHashView } from "../hooks/useHashView";
import type { Session } from "../hooks/useSession";
import AdminView from "./AdminView";
import AuctionView from "./AuctionView";
import QueueView from "./QueueView";
import TopBar from "./TopBar";

type Props = {
  session: Session;
  data: GuildData;
  isThai: boolean;
  onToggleLanguage: () => void;
  notice: string;
  notify: (message: string) => void;
  clearNotice: () => void;
};

/**
 * The signed-in tools. The roster, jobs and events START from the API data; attendance (WP12), the team plan (WP13)
 * and the auctions (WP14) use the API. Still local mock state: only the job edits (WP15).
 */
export default function Workspace({ session, data, isThai, onToggleLanguage, notice, notify, clearNotice }: Props) {
  const { activeView: requestedView, setActiveView } = useHashView();
  // the admin page exists only for admins (the server also enforces it on every call)
  const activeView = requestedView === "admin" && !session.isAdmin ? "auction" : requestedView;
  const guild = useGuildState({
    initialMembers: data.members,
    initialJobs: data.jobs,
    initialActivities: data.activities,
    isThai,
    notify,
  });

  return (
    <>
      <TopBar
        session={session}
        isThai={isThai}
        onToggleLanguage={onToggleLanguage}
      />

      <nav className="feature-nav" aria-label="Guild tools">
        <button className={activeView === "auction" ? "active" : ""} type="button" onClick={() => setActiveView("auction")}>
          <Package size={15} /> {isThai ? "ประมูลไอเท็ม" : "Auction"}
        </button>
        <button className={activeView === "queue" ? "active" : ""} type="button" onClick={() => setActiveView("queue")}>
          <ListOrdered size={15} /> {isThai ? "จองคิวประมูล" : "Auction queue"}
        </button>
        <button className={activeView === "calendar" ? "active" : ""} type="button" onClick={() => setActiveView("calendar")}>
          <CalendarDays size={15} /> {isThai ? "ตารางกิจกรรม" : "Schedule"}
        </button>
        <button className={activeView === "teams" ? "active" : ""} type="button" onClick={() => setActiveView("teams")}>
          <Users size={15} /> {isThai ? "จัดทีมกิลด์" : "Team planner"}
        </button>
        {session.isAdmin && (
          <button className={activeView === "admin" ? "active" : ""} type="button" onClick={() => setActiveView("admin")}>
            <Shield size={15} /> {isThai ? "แอดมิน" : "Admin"}
          </button>
        )}
      </nav>

      <AuctionView
        visible={activeView === "auction"}
        isThai={isThai}
        isAdmin={session.isAdmin}
        memberId={session.memberId}
        members={guild.members}
        notify={notify}
      />

      {activeView === "queue" && (
        <div className="feature-content">
          <QueueView
            isThai={isThai}
            isAdmin={session.isAdmin}
            memberId={session.memberId}
            members={guild.members}
            jobs={guild.jobs}
            notify={notify}
            onGoToAuction={() => setActiveView("auction")}
          />
        </div>
      )}
      {activeView === "calendar" && (
        <div className="feature-content">
          <WeeklySchedule
            isThai={isThai}
            memberId={session.memberId}
            isAdmin={session.isAdmin}
            jobs={guild.jobs}
            members={guild.members}
            events={data.events}
            activities={guild.activities}
            onNotice={notify}
          />
        </div>
      )}
      {activeView === "teams" && (
        <div className="feature-content wide">
          <TeamPlanner
            isThai={isThai}
            isAdmin={session.isAdmin}
            jobs={guild.jobs}
            members={guild.members}
            events={data.events}
            activities={guild.activities}
            onNotice={notify}
          />
        </div>
      )}
      {activeView === "admin" && session.isAdmin && (
        <div className="feature-content wide">
          <AdminView
            isThai={isThai}
            jobs={guild.jobs}
            members={guild.members}
            activities={guild.activities}
            onSaveJobs={guild.saveJobs}
            onMembersChanged={() => void getMembers().then(guild.setMembers, () => {})}
            onActivityChanged={guild.updateActivity}
            notify={notify}
          />
        </div>
      )}

      {notice && (
        <div className="toast">
          <Check size={16} /> {notice}
          <button type="button" onClick={clearNotice}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
