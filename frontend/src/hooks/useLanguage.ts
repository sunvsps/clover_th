import { useState } from "react";

export function useLanguage() {
  const [language, setLanguage] = useState<"en" | "th">("en");
  return {
    language,
    isThai: language === "th",
    toggleLanguage: () => setLanguage((current) => (current === "en" ? "th" : "en")),
  };
}
