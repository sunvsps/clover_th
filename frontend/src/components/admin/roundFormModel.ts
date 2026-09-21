import type { RoundItemInput, RoundSummary } from "../../api";

export type RoundFormValue = { type: RoundSummary["type"]; name: string; durationSec: number; startDelaySec: number; winCap: number; items: RoundItemInput[] };

export const emptyRound = (): RoundFormValue => ({ type: "liveClaim", name: "", durationSec: 300, startDelaySec: 3, winCap: 5, items: [{ name: "", category: "pet", rarity: "", imageUrl: "" }] });
