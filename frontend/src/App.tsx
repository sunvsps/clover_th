import { CalendarDays, Check, Package, Users, X } from "lucide-react";
import "./App.css";
import "./features.css";
import WeeklySchedule from "./components/WeeklySchedule";
import TeamPlanner from "./components/TeamPlanner";
import { useAdminControls } from "./hooks/useAdminControls";
import { useAuction } from "./hooks/useAuction";
import { useGuildState } from "./hooks/useGuildState";
import { useHashView } from "./hooks/useHashView";
import { useLanguage } from "./hooks/useLanguage";
import { useNotice } from "./hooks/useNotice";
import { useSession } from "./hooks/useSession";
import AuctionOverlays from "./views/AuctionOverlays";
import AuctionView from "./views/AuctionView";
import TopBar from "./views/TopBar";

/** Application shell: wires the state hooks to the views. All state and behaviour lives in `hooks/` and `views/`. */
function App() {
  const { notice, setNotice, clearNotice } = useNotice();
  const { isThai, toggleLanguage } = useLanguage();
  const { activeView, setActiveView } = useHashView();
  const session = useSession({ notify: setNotice });
  const auction = useAuction({ isAuthenticated: session.isAuthenticated, ign: session.ign, notify: setNotice });
  const admin = useAdminControls({
    lockedPages: auction.lockedPages,
    setLockedPages: auction.setLockedPages,
    notify: setNotice,
  });
  const guild = useGuildState({
    isAuthenticated: session.isAuthenticated,
    isAdmin: session.isAdmin,
    userName: session.userName,
    isThai,
    notify: setNotice,
    onMemberRenamed: admin.renameAdminMember,
    onMemberRemoved: admin.dropAdminMember,
  });

  return (
    <main className={`app-shell ${isThai ? "thai-theme" : ""}`}>
      <TopBar
        session={session}
        isThai={isThai}
        onToggleLanguage={toggleLanguage}
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
        notify={setNotice}
      />

      {activeView === "calendar" && (
        <div className="feature-content">
          <WeeklySchedule
            isThai={isThai}
            userName={session.userName || "Guest"}
            isAdmin={session.isAdmin}
            jobs={guild.jobs}
            members={guild.members}
            attendance={guild.attendance}
            onSetAttendance={guild.updateAttendance}
            onNotice={setNotice}
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
            assignments={guild.teamAssignments}
            onAssign={guild.assignMember}
            onRemove={guild.removeMemberFromTeam}
            onClear={guild.clearTeams}
            onAddMember={guild.addMember}
            onRenameMember={guild.renameMember}
            onSetMemberJob={guild.setMemberJob}
            onRemoveMember={guild.removeMember}
            onSaveJobs={guild.saveJobs}
            onNotice={setNotice}
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
    </main>
  );
}

export default App;
