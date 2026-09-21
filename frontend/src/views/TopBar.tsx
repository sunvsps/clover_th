import { ChevronDown, Crown, Hash, LogOut } from "lucide-react";
import type { Session } from "../hooks/useSession";

type Props = {
  session: Session;
  isThai: boolean;
  onToggleLanguage: () => void;
};

/** The auth/session shell: brand, language toggle, sign-in / sign-out and the ADMIN / USER badge. */
export default function TopBar({ session, isThai, onToggleLanguage }: Props) {
  const { isAuthenticated, userName, isAdmin } = session;

  return (
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
          <button className="language-toggle" type="button" onClick={onToggleLanguage} title="Switch language">
            {isThai ? "EN" : "TH"}
          </button>
          {isAuthenticated ? (
            <>
              <span className="avatar">{userName.charAt(0)}</span>
              <span>{userName}</span>
              {isAdmin ? (
                <span className="top-admin-badge">ADMIN</span>
              ) : (
                <span className="top-user-badge">USER</span>
              )}
              <ChevronDown size={14} />
              <button className="logout-button" type="button" onClick={session.signOut} title="Sign out">
                <LogOut size={14} />
              </button>
            </>
          ) : (
            <button className="top-login-button" type="button" onClick={session.signIn}>
              <Hash size={15} /> Sign in with Discord
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
