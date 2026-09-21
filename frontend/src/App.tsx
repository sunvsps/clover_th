import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, CircleHelp, Crown, Hash, ListOrdered, LogOut, Package, Settings, Users, X } from "lucide-react";
import "./App.css";
import "./features.css";
import { auth, isMockMode, mockLogin, mockMembers, resetMock, roster, setUnauthorizedHandler, type Me } from "./api";
import { findJob, jobStyle } from "./data/guild";
import type { GuildData } from "./lib/types";
import { describeError } from "./api/errors";
import PageAuctionView from "./views/PageAuctionView";
import AdminView from "./views/AdminView";
import WeeklySchedule from "./components/WeeklySchedule";
import TeamPlanner from "./components/TeamPlanner";

type GuildView = "auction" | "auctionQueue" | "calendar" | "teams" | "admin";
const VIEWS: GuildView[] = ["auction", "auctionQueue", "calendar", "teams", "admin"];

function viewFromHash(): GuildView {
  const hash = window.location.hash.replace("#", "") as GuildView;
  return VIEWS.includes(hash) ? hash : "auction";
}

type Session = { status: "loading" } | { status: "anon" } | { status: "ready"; me: Me };

function App() {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [authError, setAuthError] = useState<string | null>(() => new URLSearchParams(window.location.search).get("authError"));
  const [viewAsAdmin, setViewAsAdmin] = useState(true);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [language, setLanguage] = useState<"en" | "th">(() => (localStorage.getItem("clover.lang") === "en" ? "en" : "th"));
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<GuildView>(() => viewFromHash());
  const [data, setData] = useState<GuildData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [demoLoginOpen, setDemoLoginOpen] = useState(false);
  const [demoSearch, setDemoSearch] = useState("");
  const mock = isMockMode();

  const isThai = language === "th";
  const me = session.status === "ready" ? session.me : null;
  const isAdmin = !!me?.isAdmin && viewAsAdmin;
  const view: GuildView = activeView === "admin" && !isAdmin ? "auction" : activeView;

  const loadMe = useCallback(async () => {
    try {
      const profile = await auth.me();
      setSession({ status: "ready", me: profile });
    } catch {
      setSession({ status: "anon" });
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [members, jobs, events, activities] = await Promise.all([roster.members(), roster.jobs(), roster.events(), roster.activities()]);
      setData({ members, membersById: new Map(members.map((member) => [member.id, member])), jobs, events, activities });
      setDataError(null);
    } catch (error) {
      setDataError(describeError(error, isThai));
    }
  }, [isThai]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession({ status: "anon" });
      setData(null);
    });
    void Promise.resolve().then(loadMe);
    return () => setUnauthorizedHandler(null);
  }, [loadMe]);

  useEffect(() => {
    if (session.status === "ready") void Promise.resolve().then(loadData);
  }, [session.status, loadData]);

  useEffect(() => {
    localStorage.setItem("clover.lang", language);
  }, [language]);

  useEffect(() => {
    if (viewFromHash() !== activeView) window.history.pushState(null, "", activeView === "auction" ? " " : `#${activeView}`);
  }, [activeView]);

  useEffect(() => {
    const syncView = () => setActiveView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function signOut() {
    try {
      await auth.logout();
    } catch {
      /* session already gone */
    }
    setSession({ status: "anon" });
    setData(null);
    setRoleMenuOpen(false);
    setActiveView("auction");
  }

  const notify = useCallback((message: string) => setNotice(message), []);
  const notifyError = useCallback((error: unknown) => setNotice(describeError(error, isThai)), [isThai]);

  const authErrorText = useMemo(() => {
    if (!authError) return null;
    const map: Record<string, [string, string]> = {
      AUTH_NOT_REGISTERED: [
        "บัญชี Discord นี้ยังไม่ได้ลงทะเบียนกับบอทกิลด์ ให้ลงทะเบียนผ่านบอทใน Discord ก่อน แล้วค่อยเข้าสู่ระบบอีกครั้ง",
        "This Discord account is not registered with the guild bot. Register through the bot in Discord, then sign in again.",
      ],
      AUTH_MEMBER_INACTIVE: ["บัญชีนี้ถูกปิดใช้งาน ติดต่อแอดมินกิลด์", "This account is deactivated. Contact a guild admin."],
      AUTH_OAUTH_FAILED: ["เข้าสู่ระบบด้วย Discord ไม่สำเร็จ ลองใหม่อีกครั้ง", "Discord sign-in failed. Please try again."],
    };
    const entry = map[authError] ?? ["เข้าสู่ระบบไม่สำเร็จ", "Sign-in failed."];
    return isThai ? entry[0] : entry[1];
  }, [authError, isThai]);

  return (
    <main className={`app-shell ${isThai ? "thai-theme" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Clover TH home">
          <span className="brand-mark">
            <Crown size={17} />
          </span>
          <span>
            <strong>Clover</strong>
            <small>GUILD CONTROL</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="season-label">Ragnarok: The New World</span>
          <div className="profile">
            <button className="language-toggle" type="button" onClick={() => setLanguage((current) => (current === "en" ? "th" : "en"))} title="Switch language">
              {isThai ? "EN" : "TH"}
            </button>
            {session.status === "loading" ? (
              <span className="top-user-badge">…</span>
            ) : me ? (
              <>
                <span className="avatar">{me.ign.charAt(0)}</span>
                <span title={me.nickname ?? undefined}>{me.ign}</span>
                {me.isAdmin ? (
                  <div className="role-menu-wrap">
                    <button className={viewAsAdmin ? "top-admin-badge" : "top-user-badge role-switch"} type="button" onClick={() => setRoleMenuOpen((open) => !open)}>
                      {viewAsAdmin ? "ADMIN" : "USER"} <ChevronDown size={11} />
                    </button>
                    {roleMenuOpen && (
                      <div className="role-menu">
                        <strong>Current role</strong>
                        <span>{viewAsAdmin ? "Administrator" : "User view (admin available)"}</span>
                        {viewAsAdmin ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveView("admin");
                                setRoleMenuOpen(false);
                              }}
                            >
                              <Settings size={12} /> Admin config
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setViewAsAdmin(false);
                                setRoleMenuOpen(false);
                                setNotice(isThai ? "สลับเป็นมุมมองผู้ใช้แล้ว" : "Switched to User view.");
                              }}
                            >
                              Switch to USER view
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setViewAsAdmin(true);
                              setRoleMenuOpen(false);
                              setNotice(isThai ? "สลับกลับเป็นมุมมองแอดมินแล้ว" : "Switched back to Admin view.");
                            }}
                          >
                            <Crown size={12} /> Switch to ADMIN view
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="top-user-badge">USER</span>
                )}
                <button className="logout-button" type="button" onClick={signOut} title="Sign out">
                  <LogOut size={14} />
                </button>
              </>
            ) : mock ? (
              <button className="top-login-button" type="button" onClick={() => setDemoLoginOpen(true)}>
                <Hash size={15} /> {isThai ? "เข้าสู่ระบบ (ทดลอง)" : "Sign in (demo)"}
              </button>
            ) : (
              <a className="top-login-button" href={auth.loginUrl}>
                <Hash size={15} /> Sign in with Discord
              </a>
            )}
          </div>
        </div>
      </header>

      <nav className="feature-nav" aria-label="Guild tools">
        <button className={view === "auction" ? "active" : ""} type="button" onClick={() => setActiveView("auction")}>
          <Package size={15} /> {isThai ? "ประมูลไอเท็ม" : "Auction"}
        </button>
        <button className={view === "auctionQueue" ? "active" : ""} type="button" onClick={() => setActiveView("auctionQueue")}>
          <ListOrdered size={15} /> {isThai ? "คิวประมูล" : "Auction queue"}
        </button>
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setActiveView("calendar")}>
          <CalendarDays size={15} /> {isThai ? "ตารางกิจกรรม" : "Schedule"}
        </button>
        <button className={view === "teams" ? "active" : ""} type="button" onClick={() => setActiveView("teams")}>
          <Users size={15} /> {isThai ? "จัดทีมกิลด์" : "Team planner"}
        </button>
        {isAdmin && (
          <button className={`admin-tab ${view === "admin" ? "active" : ""}`} type="button" onClick={() => setActiveView("admin")}>
            <Settings size={15} /> {isThai ? "ตั้งค่าแอดมิน" : "Admin config"}
          </button>
        )}
      </nav>

      {mock && (
        <div className="feature-content slim">
          <p className="demo-banner">
            <strong>{isThai ? "โหมดทดลอง" : "Demo mode"}</strong>{" "}
            {isThai ? "ข้อมูลทั้งหมดอยู่ในเบราว์เซอร์นี้ (ยังไม่เชื่อมฐานข้อมูล) รีเฟรชแล้วยังอยู่ แต่คนอื่นไม่เห็น" : "All data lives in this browser (no database connected yet). It survives refresh but nobody else sees it."}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (window.confirm(isThai ? "ล้างข้อมูลทดลองทั้งหมดและเริ่มใหม่?" : "Reset all demo data?")) {
                  resetMock();
                  window.location.reload();
                }
              }}
            >
              {isThai ? "ล้างข้อมูลทดลอง" : "Reset demo data"}
            </button>
          </p>
        </div>
      )}

      {demoLoginOpen && mock && (
        <div className="page-modal-backdrop" role="presentation" onClick={() => setDemoLoginOpen(false)}>
          <section className="page-modal demo-login" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">{isThai ? "โหมดทดลอง" : "DEMO MODE"}</p>
                <h2>{isThai ? "เข้าสู่ระบบเป็นใคร?" : "Sign in as…"}</h2>
                <small className="event-dialog-status">{isThai ? "ของจริงจะใช้บัญชี Discord ที่ลงทะเบียนกับบอท — ตรงนี้เลือกสมาชิกเพื่อทดลองได้เลย (คนที่มี ADMIN คือหัวหน้ากิลด์)" : "The real app signs in with Discord; here just pick a member (ADMIN = guild leadership)."}</small>
              </div>
              <button type="button" className="modal-close" onClick={() => setDemoLoginOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <label className="team-search pool-search">
              <input type="search" autoFocus value={demoSearch} onChange={(event) => setDemoSearch(event.target.value)} placeholder={isThai ? "ค้นหาชื่อ..." : "Search..."} />
            </label>
            <ul className="demo-members">
              {mockMembers()
                .filter((member) => !demoSearch.trim() || member.ign.toLowerCase().includes(demoSearch.trim().toLowerCase()))
                .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.ign.localeCompare(b.ign))
                .slice(0, 40)
                .map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        mockLogin(member.id);
                        setDemoLoginOpen(false);
                        setAuthError(null);
                        void loadMe();
                      }}
                    >
                      <i className="job-dot" style={jobStyle(data ? findJob(data.jobs, member.jobId) : undefined)} />
                      {member.ign}
                      {member.isAdmin && <em className="tag">ADMIN</em>}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      )}

      {authErrorText && (
        <div className="feature-content">
          <section className="auth-error">
            <strong>{isThai ? "เข้าสู่ระบบไม่สำเร็จ" : "Sign-in problem"}</strong>
            <p>{authErrorText}</p>
            <button
              type="button"
              className="copy-button"
              onClick={() => {
                setAuthError(null);
                window.history.replaceState(null, "", window.location.pathname + window.location.hash);
              }}
            >
              {isThai ? "ปิด" : "Dismiss"}
            </button>
          </section>
        </div>
      )}

      {me?.isIncomplete && (
        <div className="feature-content slim">
          <p className="queue-warning">
            {isThai ? "โปรไฟล์ของคุณยังไม่ครบ (ไม่มีชื่อเล่น) แจ้งแอดมินให้เติมข้อมูลได้" : "Your profile is incomplete (no nickname). Ask an admin to complete it."}
          </p>
        </div>
      )}

      {session.status === "anon" && !authErrorText && (
        <div className="feature-content">
          <section className="login-panel">
            <span className="login-art">
              <Crown size={22} />
            </span>
            <div>
              <p className="eyebrow">CLOVER_TH</p>
              <h2>{isThai ? "เข้าสู่ระบบด้วย Discord เพื่อใช้งาน" : "Sign in with Discord to continue"}</h2>
              <p>{isThai ? "ใช้บัญชี Discord ที่ลงทะเบียนกับบอทกิลด์" : "Use the Discord account registered with the guild bot."}</p>
            </div>
            {mock ? (
              <button className="discord-button" type="button" onClick={() => setDemoLoginOpen(true)}>
                <Hash size={15} /> {isThai ? "เลือกสมาชิกเพื่อทดลอง" : "Pick a member to demo"}
              </button>
            ) : (
              <a className="discord-button" href={auth.loginUrl}>
                <Hash size={15} /> Sign in with Discord
              </a>
            )}
          </section>
        </div>
      )}

      {session.status === "loading" && <div className="feature-content loading-hint">{isThai ? "กำลังโหลด…" : "Loading…"}</div>}

      {me && dataError && (
        <div className="feature-content slim">
          <p className="queue-warning">
            {dataError}{" "}
            <button type="button" className="link-button" onClick={() => void loadData()}>
              {isThai ? "ลองใหม่" : "Retry"}
            </button>
          </p>
        </div>
      )}

      {me && data && (
        <>
          {view === "auction" && (
            <div className="feature-content">
              <PageAuctionView isThai={isThai} me={me} isAdmin={isAdmin} data={data} notify={notify} notifyError={notifyError} reloadData={loadData} tab="board" onGoToBoard={() => setActiveView("auction")} />
            </div>
          )}
          {view === "auctionQueue" && (
            <div className="feature-content">
              <PageAuctionView isThai={isThai} me={me} isAdmin={isAdmin} data={data} notify={notify} notifyError={notifyError} reloadData={loadData} tab="queue" onGoToBoard={() => setActiveView("auction")} />
            </div>
          )}
          {view === "calendar" && (
            <div className="feature-content">
              <WeeklySchedule isThai={isThai} me={me} isAdmin={isAdmin} data={data} notify={notify} notifyError={notifyError} reloadData={loadData} />
            </div>
          )}
          {view === "teams" && (
            <div className="feature-content wide">
              <TeamPlanner isThai={isThai} me={me} isAdmin={isAdmin} data={data} notify={notify} notifyError={notifyError} reloadData={loadData} />
            </div>
          )}
          {view === "admin" && isAdmin && (
            <div className="feature-content wide">
              <AdminView isThai={isThai} me={me} data={data} reloadData={loadData} notify={notify} notifyError={notifyError} />
            </div>
          )}
          <footer className="app-footer">
            <span>CLOVER_TH</span>
            <span>
              Built for fair drops · <CircleHelp size={13} /> Need help?
            </span>
          </footer>
        </>
      )}

      {notice && (
        <div className="toast">
          <Check size={16} /> {notice}
          <button type="button" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </main>
  );
}

export default App;
