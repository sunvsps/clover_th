import { useState } from "react";

/** The toast message shown at the bottom of the page. */
export function useNotice() {
  const [notice, setNotice] = useState("");
  return { notice, setNotice, clearNotice: () => setNotice("") };
}
