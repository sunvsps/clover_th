import type { Plan, PlacedRegistration } from "../api";

/** Pure helpers for the team planner (unit-tested separately from the component). */

export const placedCount = (team: { placements: unknown[] }) => team.placements.length;

/** memberId -> "roomKey/teamId" for everyone placed in the plan (feeds the members-per-job chart). */
export function assignmentsOf(plan: Plan | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const room of plan?.rooms ?? []) for (const team of room.teams) for (const p of team.placements) out[p.memberId] = `${room.key}/${team.id}`;
  return out;
}

/** Text for a placed member whose registration does not match the placement, or null when all is well. */
export function flagText(registration: PlacedRegistration, isThai: boolean): string | null {
  if (registration === "joined") return null;
  if (registration === "none") return isThai ? "ไม่ได้ลงทะเบียน" : "Not registered";
  if (registration === "waitlisted") return isThai ? "อยู่คิวสำรอง" : "Waitlisted";
  return isThai ? "ลา" : "On leave";
}

export function backfillText(replaced: string | null, isThai: boolean): string {
  return isThai
    ? `เลื่อนจากสำรองอัตโนมัติ${replaced ? ` แทน ${replaced}` : ""}`
    : `Auto-promoted from reserve${replaced ? `, replaced ${replaced}` : ""}`;
}

type Names = (memberId: string) => string;

const teamOf = (plan: Plan, memberId: string) => {
  for (const room of plan.rooms) for (const team of room.teams) if (team.placements.some((p) => p.memberId === memberId)) return { room, team };
  return null;
};

/**
 * What changed between two reads of the same plan, for the toast: a new auto-backfill placement (someone left and a
 * reserve was placed), else a plain "the plan was updated" when the version rose without our own write.
 */
export function planChangeNotices(prev: Plan, next: Plan, ownVersion: number, isThai: boolean, ignOf: Names): string[] {
  const known = new Set<string>();
  for (const room of prev.rooms) for (const team of room.teams) for (const p of team.placements) if (p.source === "autoBackfill") known.add(`${p.memberId}@${p.backfill?.at}`);
  const out: string[] = [];
  for (const room of next.rooms) {
    for (const team of room.teams) {
      for (const p of team.placements) {
        if (p.source !== "autoBackfill" || known.has(`${p.memberId}@${p.backfill?.at}`)) continue;
        const replaced = p.backfill?.vacatedMemberId ? ignOf(p.backfill.vacatedMemberId) : null;
        out.push(
          isThai
            ? `${ignOf(p.memberId)} ถูกเลื่อนจากสำรองเข้า ${team.name}${replaced ? ` แทน ${replaced}` : ""} อัตโนมัติ`
            : `${ignOf(p.memberId)} was auto-promoted from reserve into ${team.name}${replaced ? `, replacing ${replaced}` : ""}.`,
        );
      }
    }
  }
  if (out.length === 0 && next.version > prev.version && next.version > ownVersion) {
    out.push(isThai ? "แผนถูกอัปเดตโดยผู้อื่น" : "The plan was updated by someone else.");
  }
  return out;
}

/** Copy-for-Discord text of the whole plan, with reserves in registration order; uses ign only. */
export function planToText(
  plan: Plan,
  opts: { title: string; isThai: boolean; ignOf: Names; jobOf: (memberId: string) => string },
): string {
  const { isThai, ignOf, jobOf } = opts;
  const lines = [opts.title, ""];
  for (const room of plan.rooms) {
    const placed = room.teams.reduce((n, t) => n + t.placements.length, 0);
    lines.push(`${room.name} (${placed}/${room.capacity})`);
    for (const team of room.teams) {
      if (team.placements.length === 0) continue;
      const list = [...team.placements].sort((a, b) => a.slot - b.slot).map((p) => `${ignOf(p.memberId)} (${jobOf(p.memberId)})`);
      lines.push(`  ${team.name}: ${list.join(", ")}`);
    }
    lines.push("");
  }
  if (plan.reserves.length) {
    lines.push(`${isThai ? "สำรอง" : "Reserves"} (${plan.reserves.length})`);
    for (const r of plan.reserves) lines.push(`  ${r.order}. ${ignOf(r.memberId)}`);
  }
  return lines.join("\n").trim();
}

export { teamOf };
