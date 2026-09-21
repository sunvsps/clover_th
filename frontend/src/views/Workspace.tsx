import { CalendarDays, Check, Package, Users, X } from "lucide-react";
import type { GuildData } from "../api";
import WeeklySchedule from "../components/WeeklySchedule";
import TeamPlanner from "../components/TeamPlanner";
import { useAdminControls } from "../hooks/useAdminControls";
import { useAuction } from "../hooks/useAuction";
import { useGuildState } from "../hooks/useGuildState";
import { useHashView } from "../hooks/useHashView";
import type { Session } from "../hooks/useSession";
import AuctionOverlays from "./AuctionOverlays";
import AuctionView from "./AuctionView";
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
 * The signed-in tools. The roster, jobs and events START from the API data; attendance (WP12) and the team plan
 * (WP13) use the API. Still local mock state: the auction board and its admin panel (WP14/WP15) and job edits (WP15).
 */
export default function Workspace({ session, data, isThai, onToggleLanguage, notice, notify, clearNotice }: Props) {
  const { activeView, setActiveView } = useHashView();
  const auction = useAuction({ isAuthenticated: session.isAuthenticated, ign: session.ign, notify });
  const admin = useAdminControls({ lockedPages: auction.lockedPages, setLockedPages: auction.setLockedPages, notify });
  const guild = useGuildState({
    initialMembers: data.members,
    initialJobs: data.jobs,
    isAdmin: session.isAdmin,
    isThai,
    notify,
  });

  return (
    <>
      <TopBar
        session={session}
        isThai={isThai}
        onToggleLanguage={onToggleLanguage}
        onSwitchToUser={() => {
          session.switchToUser();
          admin.setAdminConfigOpen(false);
        }}
      />

      <nav className="feature-nav" aria-label="Guild tools">
        <button className={activeView === "auction" ? "active" : ""} type="button" onClick={() => setActiveView("auction")}>
          <Package size={15} /> {isThai ? "ประมูลไอเท็ม" : "Auction"}
        </button>
        <button className={activeView === "calendar" ? "active" : ""} type="button" onClick={() => setActiveView("calendar")}>
          <CalendarDays size={15} /> {isThai ? "ตารางกิจกรรม" : "Schedule"}
        </button>
        <button className={activeView === "teams" ? "active" : ""} type="button" onClick={() => setActiveView("teams")}>
          <Users size={15} /> {isThai ? "จัดทีมกิลด์" : "Team planner"}
        </button>
      </nav>

      <AuctionView
        visible={activeView === "auction"}
        isThai={isThai}
        isAuthenticated={session.isAuthenticated}
        isAdmin={session.isAdmin}
        ign={session.ign}
        members={guild.members}
        auction={auction}
        admin={admin}
        notify={notify}
      />

      {activeView === "calendar" && (
        <div className="feature-content">
          <WeeklySchedule
            isThai={isThai}
            memberId={session.memberId}
            isAdmin={session.isAdmin}
            jobs={guild.jobs}
            members={guild.members}
            events={data.events}
            activities={data.activities}
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
            activities={data.activities}
            onSaveJobs={guild.saveJobs}
            onNotice={notify}
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
      <AuctionOverlays auction={auction} isThai={isThai} />
    </>
  );
}
