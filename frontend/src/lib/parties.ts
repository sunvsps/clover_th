import { useCallback, useSyncExternalStore } from "react";
import { normalizeIgn } from "./gearScores";

/**
 * "Regular parties" — small groups of members who always play together, kept in this browser
 * (localStorage) since the API has no concept of them. Used by the team planner to place a
 * whole group into a subteam in one action instead of dragging each member one by one.
 *
 * A numbered set of slots (not member-created groups) so the board is just "drag a card into a
 * slot, drag it out again" — no naming, no typing, no risk of misspelling a name. The slot count
 * starts at 20 and grows (never shrinks) whenever the admin adds another one.
 */
export type Party = { id: string; index: number; label: string; color: string; memberIgns: string[] };

export const DEFAULT_PARTY_COUNT = 20;
export const partyPalette = ["#f2647c", "#5cc8ff", "#ffb84d", "#9b7bff", "#5cd98a", "#ff8fd6", "#7de0d0", "#e0c15c", "#c98bff", "#6fa8ff", "#ff9a6b", "#8fe07d", "#e88ad1", "#7ea8ff", "#78e08f", "#f7a072", "#a29bfe", "#55d6c2", "#ffa8d5", "#a7c957"];

type Store = { count: number; members: Record<string, string[]> }; // members: partyId -> normalized igns

const KEY = "clover.parties";
let cache: Store | null = null;
const listeners = new Set<() => void>();

/** Reads old-format records transparently, so parties saved before the drag board (or before slot counts) existed carry over. */
function readStore(): Store {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (raw && typeof raw === "object" && "members" in raw && typeof (raw as { count?: unknown }).count === "number") {
      const typed = raw as Store;
      cache = { count: Math.max(DEFAULT_PARTY_COUNT, typed.count), members: typed.members };
    } else if (raw && typeof raw === "object") {
      // Legacy flat format: partyId -> string[] | { memberIgns: string[] }.
      const members: Record<string, string[]> = {};
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(value)) members[id] = value as string[];
        else if (value && typeof value === "object" && Array.isArray((value as { memberIgns?: unknown }).memberIgns)) members[id] = (value as { memberIgns: string[] }).memberIgns;
      }
      cache = { count: DEFAULT_PARTY_COUNT, members };
    } else {
      cache = { count: DEFAULT_PARTY_COUNT, members: {} };
    }
  } catch {
    cache = { count: DEFAULT_PARTY_COUNT, members: {} };
  }
  return cache;
}
function writeStore(next: Store) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function buildParties(store: Store): Party[] {
  return Array.from({ length: store.count }, (_, i) => {
    const id = `party-${i + 1}`;
    return { id, index: i + 1, label: `ปาร์ตี้ ${i + 1}`, color: partyPalette[i % partyPalette.length], memberIgns: store.members[id] ?? [] };
  });
}

export function useParties() {
  const store = useSyncExternalStore(subscribe, readStore, readStore);
  const parties = buildParties(store);
  const partyOf = useCallback((ign: string) => parties.find((party) => party.memberIgns.includes(normalizeIgn(ign))), [parties]);
  const setPartyMembers = useCallback((partyId: string, memberIgns: string[]) => {
    const current = readStore();
    writeStore({ ...current, members: { ...current.members, [partyId]: memberIgns } });
  }, []);
  /** Moves a member into `toPartyId` (or just removes them from their party if null), taking them out of any other slot first. */
  const moveMember = useCallback((ign: string, toPartyId: string | null) => {
    const norm = normalizeIgn(ign);
    const current = readStore();
    const nextMembers: Record<string, string[]> = {};
    for (let i = 0; i < current.count; i += 1) {
      const id = `party-${i + 1}`;
      nextMembers[id] = (current.members[id] ?? []).filter((x) => x !== norm);
    }
    if (toPartyId) nextMembers[toPartyId] = [...(nextMembers[toPartyId] ?? []), norm];
    writeStore({ ...current, members: nextMembers });
  }, []);
  /** Adds one more numbered slot to the board (slots never auto-shrink). */
  const addSlot = useCallback(() => {
    const current = readStore();
    writeStore({ ...current, count: current.count + 1 });
  }, []);
  const clear = useCallback(() => writeStore({ count: readStore().count, members: {} }), []);
  const hasAny = parties.some((party) => party.memberIgns.length > 0);
  return { parties, partyOf, setPartyMembers, moveMember, addSlot, clear, hasAny };
}

/** Loosely comparable form of a name: letters/digits only, lowercase, 0 unified with O. Used only to seed the board once from the guild's known regular parties. */
export const looseKey = (name: string) =>
  normalizeIgn(name)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/0/g, "o");

/** Splits text into blocks on a blank line or a run of -_—= characters; strips "1." numbering and trailing " - note" annotations. */
export function parsePartyBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-_—=]{3,}$/.test(line)) {
      flush();
      continue;
    }
    const name = line
      .replace(/^\d+[.)]\s*/, "")
      .split(/\s+-\s+/)[0]
      .trim();
    if (name) current.push(name);
  }
  flush();
  return blocks;
}

/** The regular parties as given by the guild (spelling fixed to match the roster export), used once to pre-fill an empty board. */
export const KNOWN_PARTIES_TEXT = `COSMOx
Claude
หมัดมังคุด
Yiren
lwชsssss
----
พยูนไม่ได้ฆ่า
Mimayuu
Gantzping
zearthz
SunnyInwZa
----
ลูกแกะผู้หลงทาง
Nuririn
วานิลาครีมชมพู
Gugora
----
กขคง
BeN888
Booooo
หอยขม
lnwสงคราม
----
มันกะเย
ChonYa
----
Free_Kill
oOSudtingOo
----
DusChMill
HuM
----
Kanade
Mirabi
IAMAHERO
-nara-
เสีEวค่ะXลวงMา
----
ลูกแกะผู้หลงทาง
Nuririn
วานิลาครีมชมพู
Gugora
Judazz
----
กะปุ๋ง
Guga
----
คนหลงทาง
-จoมมๅรบุญ-
----
ฮๅโย่ววว
ตาแกะ
Chell
ปุ๋ง-ปุ๋งงง
Sad-Bang
----
Dopeboyz`;

/** Resolves each raw name in a block to a roster member's normalized IGN, using an exact match, then a loose (punctuation/case/0-vs-O insensitive) match, then a unique substring match. */
export function resolvePartyBlocks(blocks: string[][], members: { ign: string }[]): string[][] {
  const byExact = new Map(members.map((member) => [normalizeIgn(member.ign), member.ign]));
  const byLoose = new Map<string, string[]>();
  members.forEach((member) => {
    const key = looseKey(member.ign);
    byLoose.set(key, [...(byLoose.get(key) ?? []), member.ign]);
  });
  const resolve = (name: string): string | undefined => {
    const exact = byExact.get(normalizeIgn(name));
    if (exact) return exact;
    const key = looseKey(name);
    const loose = byLoose.get(key);
    if (loose?.length === 1) return loose[0];
    if (key.length >= 3) {
      const bySubstring = members.filter((member) => {
        const memberKey = looseKey(member.ign);
        return memberKey.includes(key) || key.includes(memberKey);
      });
      if (bySubstring.length === 1) return bySubstring[0].ign;
    }
    return undefined;
  };
  return blocks.map((names) => names.map(resolve).filter((ign): ign is string => !!ign));
}
