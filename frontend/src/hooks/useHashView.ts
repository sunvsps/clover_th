import { useEffect, useState } from "react";

export type GuildView = "auction" | "calendar" | "teams";

export function viewFromHash(): GuildView {
  const hash = window.location.hash.replace("#", "");
  return hash === "calendar" || hash === "teams" ? hash : "auction";
}

/** Active feature view kept in sync with the URL hash (back/forward buttons included). */
export function useHashView() {
  const [activeView, setActiveView] = useState<GuildView>(() => viewFromHash());

  useEffect(() => {
    if (viewFromHash() !== activeView) {
      window.history.pushState(null, "", activeView === "auction" ? " " : `#${activeView}`);
    }
  }, [activeView]);

  useEffect(() => {
    const syncView = () => setActiveView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  return { activeView, setActiveView };
}
