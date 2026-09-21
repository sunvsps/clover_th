import { describe, expect, it } from "vitest";
import { myChangeNotices, placementLabel, statusText, writeNotices } from "./scheduleModel";

const ignOf = (id: string) => ({ a: "Aria", b: "Bo", c: "Cleo" })[id] ?? id;
const base = { status: "joined" as const, waitlistPosition: null, promoted: [], backfilled: [], planVersion: 1 };

describe("scheduleModel", () => {
  it("placement label: Placed / Reserve #n, and nothing for activities without a planner", () => {
    expect(placementLabel({ memberId: "a", status: "joined", placed: true }, false)).toBe("Placed");
    expect(placementLabel({ memberId: "a", status: "joined", placed: false, reserveOrder: 3 }, false)).toBe("Reserve #3");
    expect(placementLabel({ memberId: "a", status: "joined" }, false)).toBeNull();
    expect(placementLabel({ memberId: "a", status: "joined", placed: false, reserveOrder: 3 }, true)).toBe("สำรอง #3");
  });

  it("status text", () => {
    expect(statusText(undefined, false)).toBe("Not set");
    expect(statusText({ memberId: "a", status: "waitlisted", waitlistPos: 2 }, false)).toBe("Waitlist #2");
    expect(statusText({ memberId: "a", status: "joined", placed: false, reserveOrder: 1 }, false)).toBe("Playing · Reserve #1");
  });

  it("write notices: waitlist position, promotion, and slot hand-over to a reserve", () => {
    const ctx = { me: "a", target: "a", isThai: false, ignOf };
    expect(writeNotices({ ...base, status: "waitlisted", waitlistPosition: 2 }, ctx)[0]).toBe("The activity is full: you are on the waitlist at #2.");
    expect(writeNotices({ ...base, status: "none", promoted: ["b"] }, ctx)).toContain("Bo was moved up from the waitlist.");
    const swap = { teamName: "Main A", slot: 4, vacatedMemberId: "a", promotedMemberId: "c" };
    expect(writeNotices({ ...base, status: "leave", backfilled: [swap] }, ctx)).toContain("Your slot in Main A was given to Cleo.");
    expect(writeNotices({ ...base, status: "none", backfilled: [{ ...swap, vacatedMemberId: "b", promotedMemberId: "a" }] }, ctx)).toContain(
      "You moved from reserve to placed in Main A.",
    );
    expect(writeNotices({ ...base, status: "none", backfilled: [{ ...swap, vacatedMemberId: "b" }] }, { ...ctx, target: "b" })).toContain(
      "Cleo moved from reserve to Main A (slot 4).",
    );
  });

  it("notices Thai text for the same events", () => {
    expect(writeNotices({ ...base, status: "waitlisted", waitlistPosition: 1 }, { me: "a", target: "a", isThai: true, ignOf })[0]).toContain("คิวสำรองลำดับที่ 1");
  });

  it("notices changes to my own registration between two roster reads", () => {
    const k = "2026-09-23:e-1";
    const before = { [k]: [{ memberId: "a", status: "waitlisted" as const, waitlistPos: 1 }] };
    const after = { [k]: [{ memberId: "a", status: "joined" as const }] };
    expect(myChangeNotices(before, after, "a", false, () => "War")).toEqual(["You were moved up from the waitlist for War."]);
    const r1 = { [k]: [{ memberId: "a", status: "joined" as const, placed: false, reserveOrder: 1 }] };
    const r2 = { [k]: [{ memberId: "a", status: "joined" as const, placed: true, reserveOrder: null }] };
    expect(myChangeNotices(r1, r2, "a", false, () => "War")).toEqual(["You moved from reserve to placed for War."]);
    expect(myChangeNotices(after, after, "a", false, () => "War")).toEqual([]);
  });
});
