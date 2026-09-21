import { describe, expect, it } from "vitest";
import type { Plan } from "../api";
import { assignmentsOf, backfillText, flagText, planChangeNotices, planToText } from "./plannerModel";

const ignOf = (id: string) => ({ a: "Aria", b: "Bo", c: "Cleo" })[id] ?? id;
const plan = (over: Partial<Plan> = {}): Plan => ({
  eventId: "e", date: "2026-09-22", startsAt: null, version: 1, autoBackfill: true,
  rooms: [{ id: 1, key: "main", name: "Main", archived: false, capacity: 5, teams: [{ id: 7, name: "Main 1", size: 5, archived: false, placements: [{ memberId: "a", slot: 1, registration: "joined", source: "admin" }] }] }],
  reserves: [{ memberId: "b", registeredAt: "", order: 1 }],
  ...over,
});

describe("plannerModel", () => {
  it("flags and backfill text", () => {
    expect(flagText("joined", false)).toBeNull();
    expect(flagText("none", false)).toBe("Not registered");
    expect(flagText("leave", true)).toBe("ลา");
    expect(backfillText("Bo", false)).toBe("Auto-promoted from reserve, replaced Bo");
    expect(backfillText(null, false)).toBe("Auto-promoted from reserve");
  });

  it("assignments list who is placed", () => {
    expect(assignmentsOf(plan())).toEqual({ a: "main/7" });
    expect(assignmentsOf(null)).toEqual({});
  });

  it("notices a new auto-backfill once, and a plain update only for versions we did not write", () => {
    const before = plan();
    const promoted = plan({ version: 2 });
    promoted.rooms[0]!.teams[0]!.placements.push({ memberId: "c", slot: 2, registration: "joined", source: "autoBackfill", backfill: { vacatedMemberId: "b", reason: "UNREGISTERED", at: "t1" } });
    expect(planChangeNotices(before, promoted, 0, false, ignOf)).toEqual(["Cleo was auto-promoted from reserve into Main 1, replacing Bo."]);
    expect(planChangeNotices(promoted, promoted, 2, false, ignOf)).toEqual([]);
    expect(planChangeNotices(before, plan({ version: 2 }), 0, false, ignOf)).toEqual(["The plan was updated by someone else."]);
    expect(planChangeNotices(before, plan({ version: 2 }), 2, false, ignOf)).toEqual([]); // our own write
    expect(planChangeNotices(before, promoted, 0, true, ignOf)[0]).toContain("อัตโนมัติ");
  });

  it("copy text uses ign, skips empty teams and numbers the reserves", () => {
    const text = planToText(plan(), { title: "T", isThai: false, ignOf, jobOf: () => "Knight" });
    expect(text).toBe("T\n\nMain (1/5)\n  Main 1: Aria (Knight)\n\nReserves (1)\n  1. Bo");
  });
});
