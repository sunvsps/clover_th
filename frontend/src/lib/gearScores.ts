import { useCallback, useSyncExternalStore } from "react";

/**
 * Gear score ("CP") per member, imported from the game's guild CSV export.
 * The API has no field for it yet, so it lives in this browser (localStorage) keyed by normalized IGN.
 * When the backend adds `gearScore` to /members, read that instead and drop this store.
 */
export type GearScore = { cp: number; level: number | null; className: string; updatedAt: string };
type Store = Record<string, GearScore>;

const KEY = "clover.gearScores";
const listeners = new Set<() => void>();
let cache: Store | null = null;

export const normalizeIgn = (ign: string) => ign.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();

function readStore(): Store {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    cache = {};
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

export function useGearScores() {
  const store = useSyncExternalStore(subscribe, readStore, readStore);
  const scoreOf = useCallback((ign: string) => store[normalizeIgn(ign)], [store]);
  const merge = useCallback((entries: Record<string, GearScore>) => writeStore({ ...readStore(), ...entries }), []);
  const clear = useCallback(() => writeStore({}), []);
  return { store, scoreOf, merge, clear };
}

export const formatCp = (cp: number) => cp.toLocaleString("en-US");

/** Parses the guild member export (UTF-8 CSV with a Thai header row). */
export type CsvRow = { ign: string; level: number | null; className: string; cp: number | null; raw: Record<string, string> };
export function parseGuildCsv(text: string): { rows: CsvRow[]; error?: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], error: "empty" };
  const split = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else current += char;
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
  };
  const header = split(lines[0]);
  const find = (...names: string[]) => header.findIndex((column) => names.some((name) => column.toLowerCase().includes(name.toLowerCase())));
  const nameIndex = find("ชื่อผู้เล่น", "name", "ign");
  const classIndex = find("คลาส", "class");
  const cpIndex = find("คะแนน gear", "gear", "cp");
  const levelIndex = find("lv", "level");
  if (nameIndex < 0) return { rows: [], error: "no-name-column" };
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    const raw: Record<string, string> = {};
    header.forEach((column, index) => (raw[column] = cells[index] ?? ""));
    const number = (value: string | undefined) => {
      const parsed = Number((value ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) && (value ?? "").trim() !== "" ? parsed : null;
    };
    return { ign: cells[nameIndex] ?? "", level: levelIndex >= 0 ? number(cells[levelIndex]) : null, className: classIndex >= 0 ? (cells[classIndex] ?? "") : "", cp: cpIndex >= 0 ? number(cells[cpIndex]) : null, raw };
  });
  return { rows: rows.filter((row) => row.ign) };
}
