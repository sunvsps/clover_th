import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, daysBetween, formatDay, isDateKey, startOfWeek, toDateKey, bangkokTime } from "./bangkok";

// `npm run test:tz` runs this file under TZ=UTC, TZ=Asia/Bangkok and TZ=America/Los_Angeles: every result must be identical.
describe("Bangkok date keys (independent of the browser time zone)", () => {
  it("uses the Bangkok calendar day for an instant", () => {
    expect(toDateKey(new Date("2026-09-21T10:00:00Z"))).toBe("2026-09-21");
  });

  it("rolls over at 00:00 Bangkok = 17:00 UTC the day before", () => {
    expect(toDateKey(new Date("2026-09-20T16:59:59.999Z"))).toBe("2026-09-20");
    expect(toDateKey(new Date("2026-09-20T17:00:00.000Z"))).toBe("2026-09-21");
  });

  it("handles month and year boundaries", () => {
    expect(toDateKey(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
    expect(toDateKey(new Date("2028-02-28T17:00:00Z"))).toBe("2028-02-29");
  });

  it("does arithmetic on keys without a time zone", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-14", "2026-09-21")).toBe(7);
  });

  it("weeks start on Monday (0 = Monday, as in the API)", () => {
    expect(dayOfWeek("2026-09-21")).toBe(0); // a Monday
    expect(dayOfWeek("2026-09-27")).toBe(6);
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("validates keys and formats days", () => {
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-09-21")).toBe(true);
    expect(formatDay("2026-09-21", false)).toBe("21 Sep");
    expect(formatDay("2026-09-21", true)).toBe("21 ก.ย.");
  });

  it("shows wall-clock times in Bangkok", () => {
    expect(bangkokTime("2026-09-21T13:00:00Z")).toBe("20:00");
  });
});
