import type { RoundItemInput, RoundSummary } from "../../api";

export type RoundFormValue = { type: RoundSummary["type"]; name: string; durationSec: number; startDelaySec: number; winCap: number; items: RoundItemInput[] };

/**
 * Default of each number field in the round form: a new round starts with it, and a field the admin clears falls
 * back to it (refilled on blur). Change one here to change it everywhere.
 */
export const FIELD_DEFAULTS = {
  /** round length */
  durationSec: 300,
  /** countdown between pressing Start and the round opening */
  startDelaySec: 3,
  /** items one member may claim in a live-claim round */
  winCap: 5,
  /** pages of 4 items */
  pages: 1,
} as const;

export const emptyRound = (): RoundFormValue => ({ type: "liveClaim", name: "", durationSec: FIELD_DEFAULTS.durationSec, startDelaySec: FIELD_DEFAULTS.startDelaySec, winCap: FIELD_DEFAULTS.winCap, items: [{ name: "", category: "pet", rarity: "", imageUrl: "" }] });
