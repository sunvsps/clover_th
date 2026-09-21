import "./App.css";
import "./features.css";
import { messageForCode } from "./api";
import { useGuildData } from "./hooks/useGuildData";
import { useLanguage } from "./hooks/useLanguage";
import { useNotice } from "./hooks/useNotice";
import { useSession } from "./hooks/useSession";
import AuthScreens from "./views/AuthScreens";
import TopBar from "./views/TopBar";
import Workspace from "./views/Workspace";

/** Application shell: the auth gate (`/me`), then the guild data load, then the tools (`views/Workspace`). */
function App() {
  const { notice, setNotice, clearNotice } = useNotice();
  const { isThai, toggleLanguage } = useLanguage();
  const session = useSession();
  const guildData = useGuildData(session.isAuthenticated);
  const signedIn = session.state.status === "ready";

  return (
    <main className={`app-shell ${isThai ? "thai-theme" : ""}`}>
      {signedIn && guildData.state.status === "ready" ? (
        <Workspace
          session={session}
          data={guildData.state.data}
          isThai={isThai}
          onToggleLanguage={toggleLanguage}
          notice={notice}
          notify={setNotice}
          clearNotice={clearNotice}
        />
      ) : (
        <>
          <TopBar session={session} isThai={isThai} onToggleLanguage={toggleLanguage} />
          {signedIn ? (
            <section className="auth-screen" role={guildData.state.status === "error" ? "alert" : "status"}>
              {guildData.state.status === "error" ? (
                <>
                  <p>{messageForCode(guildData.state.error?.code ?? "NETWORK_ERROR", isThai, guildData.state.error?.message)}</p>
                  <button type="button" onClick={() => void guildData.reload()}>
                    {isThai ? "ลองอีกครั้ง" : "Retry"}
                  </button>
                </>
              ) : (
                <p>{isThai ? "กำลังโหลดข้อมูลกิลด์…" : "Loading guild data…"}</p>
              )}
            </section>
          ) : (
            <AuthScreens session={session} isThai={isThai} />
          )}
        </>
      )}
    </main>
  );
}

export default App;
