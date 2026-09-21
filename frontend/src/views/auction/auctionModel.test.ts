import { describe, expect, it } from "vitest";
import { ApiError, type AuctionItem } from "../../api";
import { auctionErrorText, formatClock, groupByCategory, moveInList, phaseOf, secondsUntil } from "./auctionModel";

const T = Date.parse("2026-09-21T10:00:00Z");
const round = (status: "open" | "closed", opensInSec: number, closesInSec: number) => ({
  status,
  opensAt: new Date(T + opensInSec * 1000).toISOString(),
  closesAt: new Date(T + closesInSec * 1000).toISOString(),
});

describe("auctionModel", () => {
  it("phase is decided on the server clock: starting, open, ended, closed", () => {
    expect(phaseOf(round("open", 3, 300), T)).toBe("starting");
    expect(phaseOf(round("open", -1, 300), T)).toBe("open");
    expect(phaseOf(round("open", -300, 0), T)).toBe("ended");
    expect(phaseOf(round("closed", -300, -1), T)).toBe("closed");
  });

  it("counts whole seconds up and formats mm:ss", () => {
    expect(secondsUntil(new Date(T + 2100).toISOString(), T)).toBe(3);
    expect(secondsUntil(new Date(T - 5000).toISOString(), T)).toBe(0);
    expect(formatClock(90)).toBe("01:30");
    expect(formatClock(-4)).toBe("00:00");
  });

  it("groups by category in the fixed order and moves list entries", () => {
    const mk = (id: number, category: AuctionItem["category"]): AuctionItem => ({ id, name: String(id), category, rarity: null, imageUrl: null, winner: null });
    expect(groupByCategory([mk(1, "relic"), mk(2, "pet"), mk(3, "gear")]).map((g) => g.category)).toEqual(["pet", "gear", "relic"]);
    expect(moveInList([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moveInList([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });

  it("error text: winner name, cap, wait time, and the generic map", () => {
    const ign = (id: string) => ({ a: "Aria" })[id] ?? id;
    expect(auctionErrorText(new ApiError(409, "ITEM_ALREADY_CLAIMED", "x", { winner: { memberId: "a" } }), false, ign)).toBe("Aria got this item first.");
    expect(auctionErrorText(new ApiError(409, "CLAIM_CAP_REACHED", "x", { winCap: 5 }), true, ign)).toContain("5");
    const limited = new ApiError(429, "RATE_LIMITED", "x");
    limited.retryAfterSec = 3;
    expect(auctionErrorText(limited, false, ign)).toContain("3 s");
    expect(auctionErrorText(new ApiError(409, "ROUND_CLOSED", "x"), false, ign)).toBe("The round is closed.");
    expect(auctionErrorText(new Error("boom"), false, ign)).toMatch(/Something went wrong/);
  });
});
