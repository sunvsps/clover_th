import { useState } from "react";
import { saveLanguage, type Me } from "../api";

export type Language = "en" | "th";

const STORE_KEY = "clover.language";
function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORE_KEY);
    return value === "en" || value === "th" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The UI language. A signed-in member's last pick is kept on the server (`/me` returns it, "en" until they switch it;
 * `PUT /me/language` saves it), so it follows them to another browser. Before sign-in this browser's own last pick
 * (localStorage) is used, else English. A switch made on this page wins until reload.
 */
export function useLanguage(me: Me | null) {
  const [stored] = useState(storedLanguage);
  const [picked, setPicked] = useState<Language | null>(null);
  const language: Language = picked ?? me?.language ?? stored ?? "en";

  function toggleLanguage() {
    const next: Language = language === "en" ? "th" : "en";
    setPicked(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* private mode: this page still switches */
    }
    if (me) void saveLanguage(next).catch(() => {}); // best effort: a failed save only means the next device starts in the old language
  }

  return { language, isThai: language === "th", toggleLanguage };
}
