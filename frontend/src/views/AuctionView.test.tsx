import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuctionView from "./AuctionView";
import { serverClock, toGuildMember } from "../api";
import { fakeAuctions, meAdmin, meUser, wireMembers, type FakeItem, type FakeRound } from "../test/api";
import type { Me } from "../api";

const SERVER = Date.parse("2026-09-21T10:00:00Z"); // the server's clock in every test
const iso = (ms: number) => new Date(ms).toISOString();
const members = wireMembers.map(toGuildMember);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SERVER));
});
afterEach(() => {
  vi.useRealTimers();
  serverClock.reset();
});

const items = (n: number, category: FakeItem["category"] = "PET", from = 1): FakeItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, name: `${category[0]}${category.slice(1).toLowerCase()} ${from + i}`, category }));

const liveRound = (over: Partial<FakeRound> = {}): FakeRound => ({
  id: 1, type: "LIVE_CLAIM", name: "Friday drops", status: "OPEN", opensAt: iso(SERVER - 60_000), closesAt: iso(SERVER + 240_000),
  items: [...items(4, "PET"), ...items(3, "GEAR", 10)], ...over,
});

function setup(me: Me, rounds: FakeRound[], opts: { isThai?: boolean; queues?: Record<string, string[]> } = {}) {
  const fake = fakeAuctions({ me, rounds, serverNow: () => SERVER, queues: opts.queues });
  const notify = vi.fn();
  const user = userEvent.setup({ delay: null });
  const view = render(<AuctionView visible isThai={opts.isThai ?? false} isAdmin={me.isAdmin} memberId={me.memberId} members={members} notify={notify} />);
  return { fake, notify, user, view };
}
const card = (name: string) => document.querySelector(`[data-item="${name}"]`) as HTMLElement;
const timer = () => document.querySelector(".round-panel .timer strong") as HTMLElement;

describe("type 1: live claim", () => {
  it("groups items by category, opens the running round by default and shows N/5", async () => {
    setup(meUser, [liveRound()]);
    await waitFor(() => expect(card("Pet 1")).toBeInTheDocument());
    expect([...document.querySelectorAll(".category-block")].map((c) => c.getAttribute("data-category"))).toEqual(["pet", "gear"]);
    expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("0/5");
    expect(within(card("Pet 1")).getByRole("button", { name: /Claim/ })).toBeEnabled();
  });

  it("the countdown follows the SERVER clock even when the browser clock is 5 minutes off", async () => {
    vi.setSystemTime(new Date(SERVER + 300_000)); // a badly skewed browser clock
    setup(meUser, [liveRound({ closesAt: iso(SERVER + 90_000) })]);
    await waitFor(() => expect(timer()).toHaveTextContent("01:30"));
    expect(screen.getByText("01:30 remaining")).toBeInTheDocument();
    expect(Math.abs(serverClock.offset() + 300_000)).toBeLessThan(1000);
    // 30 real seconds pass on both clocks: the countdown still agrees with the server
    vi.setSystemTime(new Date(SERVER + 330_000));
    await waitFor(() => expect(timer()).toHaveTextContent("01:00"), { timeout: 2000 });
  });

  it("a round that has not opened yet shows the 3-2-1 countdown and disables claiming", async () => {
    setup(meUser, [liveRound({ opensAt: iso(SERVER + 3000), closesAt: iso(SERVER + 300_000) })]);
    await waitFor(() => expect(document.querySelector(".countdown-modal strong")).toHaveTextContent("3"));
    expect(within(card("Pet 1")).getByRole("button", { name: /Claim/ })).toBeDisabled();
  });

  it("claim and release update the card and the counter at once", async () => {
    const { fake, user, notify } = setup(meUser, [liveRound()]);
    await waitFor(() => expect(card("Pet 1")).toBeInTheDocument());
    await user.click(within(card("Pet 1")).getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("1/5"));
    expect(card("Pet 1")).toHaveTextContent("Yours");
    expect(notify).toHaveBeenCalledWith("Pet 1 is yours (1/5).");
    expect(fake.calls.some((c) => c.method === "POST" && c.path.endsWith("/rounds/1/items/1/claim"))).toBe(true);
    await user.click(within(card("Pet 1")).getByRole("button", { name: /Release/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("0/5"));
    expect(within(card("Pet 1")).getByRole("button", { name: /Claim/ })).toBeInTheDocument();
  });

  it("a claim that loses to another member shows the winner's name, and the card shows who has it", async () => {
    const { fake, user, notify } = setup(meUser, [liveRound()]);
    await waitFor(() => expect(card("Pet 2")).toBeInTheDocument());
    fake.claimBy(1, 2, "m-cleo"); // Cleo was faster; this screen has not polled yet
    await user.click(within(card("Pet 2")).getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Cleo got this item first."));
    await waitFor(() => expect(card("Pet 2")).toHaveTextContent("Claimed by Cleo"));
    expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("0/5");
  });

  it("the 6th claim shows the cap message and the counter stays at 5/5", async () => {
    const { user, notify } = setup(meUser, [liveRound({ items: items(6, "PET") })]);
    await waitFor(() => expect(card("Pet 1")).toBeInTheDocument());
    for (const n of [1, 2, 3, 4, 5]) {
      await user.click(within(card(`Pet ${n}`)).getByRole("button", { name: /Claim/ }));
      await waitFor(() => expect(within(card(`Pet ${n}`)).getByRole("button", { name: /Release/ })).toBeInTheDocument());
    }
    await user.click(within(card("Pet 6")).getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("You have reached the limit of 5 items in this round. Release one to claim another."));
    expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("5/5");
  });

  it("a rate limit tells the member how long to wait (Retry-After)", async () => {
    const { fake, user, notify } = setup(meUser, [liveRound()]);
    await waitFor(() => expect(card("Pet 1")).toBeInTheDocument());
    fake.rateLimitNext();
    await user.click(within(card("Pet 1")).getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Too many requests. Please wait 2 s and try again."));
  });

  it("errors and labels are available in Thai", async () => {
    const { fake, user, notify } = setup(meUser, [liveRound()], { isThai: true });
    await waitFor(() => expect(card("Pet 2")).toBeInTheDocument());
    fake.claimBy(1, 2, "m-cleo");
    await user.click(within(card("Pet 2")).getByRole("button", { name: /จอง/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Cleo จองไอเท็มนี้ไปก่อนแล้ว"));
  });

  it("refreshing mid-round restores the state from the server (own claims, others' winners, the clock)", async () => {
    const round = liveRound();
    round.items[0]!.winner = meUser.memberId;
    round.items[1]!.winner = "m-dax";
    const first = setup(meUser, [round]);
    await waitFor(() => expect(card("Pet 1")).toHaveTextContent("Yours"));
    first.view.unmount(); // "refresh the page"
    setup(meUser, [round]);
    await waitFor(() => expect(card("Pet 1")).toHaveTextContent("Yours"));
    expect(card("Pet 2")).toHaveTextContent("Claimed by Dax");
    expect(screen.getByRole("status", { name: "Your claims" })).toHaveTextContent("1/5");
    expect(timer()).toHaveTextContent("04:00");
  });

  it("polls with If-None-Match after the first answer (an unchanged round is a 304)", async () => {
    vi.useRealTimers();
    const { fake } = setup(meUser, [liveRound()]);
    await waitFor(() => expect(card("Pet 1")).toBeInTheDocument());
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "GET" && c.ifNoneMatch).length).toBeGreaterThan(0), { timeout: 4000 });
  });

  it("after the round closes the results show the winners with names, and my items", async () => {
    const round = liveRound({ status: "CLOSED" });
    round.items[0]!.winner = meUser.memberId;
    round.items[1]!.winner = "m-cleo";
    setup(meUser, [round]);
    await screen.findByTestId("round-results");
    expect(within(screen.getByTestId("round-results")).getByText("Pet 1", { selector: "li" })).toBeInTheDocument();
    expect(card("Pet 2")).toHaveTextContent("Cleo");
    expect(card("Pet 3")).toHaveTextContent("No winner");
    expect(screen.queryByRole("button", { name: /Claim/ })).not.toBeInTheDocument();
  });
});

describe("type 2: ranked queues", () => {
  const queueRound = (over: Partial<FakeRound> = {}): FakeRound => ({
    id: 2, type: "QUEUE_RANKED", name: "Queue round", status: "OPEN", opensAt: iso(SERVER - 1000), closesAt: iso(SERVER + 600_000),
    items: [...items(3, "GEAR", 1), ...items(2, "CARD", 10)], eligible: ["GEAR"], ...over,
  });

  it("only categories where I was queued accept preferences", async () => {
    setup(meUser, [queueRound()]);
    await screen.findByTestId("queue-round");
    const cards = document.querySelector('[data-category="card"]') as HTMLElement;
    expect(within(cards).queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
    expect(cards).toHaveTextContent("not in this queue");
    const gear = document.querySelector('[data-category="gear"]') as HTMLElement;
    expect(within(gear).getAllByRole("button", { name: /Add/ })).toHaveLength(3);
  });

  it("rank, reorder and save: an explicit success message, and the list is what the server stores", async () => {
    const { fake, user, notify } = setup(meUser, [queueRound()]);
    await screen.findByTestId("queue-round");
    await waitFor(() => expect(within(card("Gear 3")).getByRole("button", { name: /Add/ })).toBeEnabled()); // my saved list has loaded
    await user.click(within(card("Gear 3")).getByRole("button", { name: /Add/ }));
    await user.click(within(card("Gear 1")).getByRole("button", { name: /Add/ }));
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move Gear 1 up" }));
    const rows = () => within(screen.getByRole("list", { name: "My ranking" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows()[0]).toContain("Gear 1");
    await user.click(screen.getByRole("button", { name: /Save my list/ }));
    await waitFor(() => expect(screen.getByText("Saved (2 items stored).")).toBeInTheDocument());
    expect(fake.prefs.get(2)).toEqual([1, 3]);
    expect(notify).toHaveBeenCalledWith("Saved: your list of 2 items is stored.");
    expect(screen.queryByText("Not saved yet")).not.toBeInTheDocument();
  });

  it("a failed save says so and keeps the unsaved list", async () => {
    const { fake, user } = setup(meUser, [queueRound()]);
    await screen.findByTestId("queue-round");
    await waitFor(() => expect(within(card("Gear 1")).getByRole("button", { name: /Add/ })).toBeEnabled());
    await user.click(within(card("Gear 1")).getByRole("button", { name: /Add/ }));
    fake.close(2); // the round closes while I am editing
    await user.click(screen.getByRole("button", { name: /Save my list/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: The round is closed.");
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
  });

  it("a saved list is loaded again after a refresh", async () => {
    const first = setup(meUser, [queueRound()]);
    await screen.findByTestId("queue-round");
    first.fake.prefs.set(2, [3, 1]);
    first.view.unmount();
    render(<AuctionView visible isThai={false} isAdmin={false} memberId={meUser.memberId} members={members} notify={vi.fn()} />);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "My ranking" })).getAllByRole("listitem")).toHaveLength(2));
  });

  it("after close: who won what with queue positions, my items, and the new queue order", async () => {
    const round = queueRound({ status: "CLOSED", items: items(3, "GEAR", 1) });
    const { fake } = setup(meUser, [round], { queues: { GEAR: ["m-cleo", "m-dax", "m-aria", "m-bo"] } });
    fake.close(2, { 1: { memberId: "m-aria", queuePos: 3 }, 2: { memberId: "m-bo", queuePos: 4 } });
    fake.setQueue("GEAR", ["m-cleo", "m-dax", "m-aria", "m-bo"]);
    await screen.findByTestId("round-results");
    await waitFor(() => expect(card("Gear 1")).toHaveTextContent("Aria · queue #3"));
    expect(card("Gear 2")).toHaveTextContent("Bo · queue #4");
    expect(screen.getByTestId("new-queues")).toHaveTextContent("Gear: Cleo, Dax, Aria, Bo");
  });

  it("the leftover draft link is shown to admins only", async () => {
    const closed = queueRound({ status: "CLOSED", items: items(2, "GEAR", 1), leftoverRoundId: 9 });
    const draft: FakeRound = { id: 9, type: "QUEUE_RANKED", name: "Leftovers", status: "DRAFT", items: items(1, "GEAR", 30) };
    const a = setup(meAdmin, [closed, draft]);
    await waitFor(() => expect(screen.getByRole("button", { name: /leftover draft round #9/i })).toBeInTheDocument());
    await a.user.click(screen.getByRole("button", { name: /leftover draft round #9/i }));
    await waitFor(() => expect(document.querySelector('[data-phase="draft"]')).toBeInTheDocument());
    expect(screen.getByText(/only admins can see it/)).toBeInTheDocument();
    a.view.unmount();

    setup(meUser, [closed, draft]);
    await screen.findByTestId("round-results");
    expect(screen.queryByRole("button", { name: /leftover/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Leftovers/ })).not.toBeInTheDocument(); // members do not even see the draft
  });
});

describe("queues tab", () => {
  it("shows my place per category and lets me join and leave", async () => {
    const { fake, user, notify } = setup(meUser, [liveRound()], { queues: { GEAR: ["m-cleo"] } });
    await user.click(await screen.findByRole("tab", { name: "Queues" }));
    const gear = await waitFor(() => {
      const el = document.querySelector('[data-queue="gear"]') as HTMLElement;
      expect(el).toHaveTextContent("Cleo");
      return el;
    });
    expect(gear).toHaveTextContent("You are not in this queue");
    await user.click(within(gear).getByRole("button", { name: /Join queue/ }));
    await waitFor(() => expect(gear).toHaveTextContent("Your place: #2"));
    expect(fake.calls.find((c) => c.method === "PUT")!.path).toMatch(/queues\/GEAR\/me$/); // upper-case category on the wire
    expect(notify).toHaveBeenCalledWith("You are #2 in the Gear queue.");
    await user.click(within(gear).getByRole("button", { name: /Leave queue/ }));
    await waitFor(() => expect(gear).toHaveTextContent("You are not in this queue"));
    expect(fake.calls.find((c) => c.method === "DELETE" && c.path.includes("queues"))!.path).toMatch(/queues\/GEAR\/me$/);
  });
});

describe("rounds list", () => {
  it("an admin sees draft rounds in the picker and a note that management is not in this screen yet", async () => {
    setup(meAdmin, [liveRound(), { id: 5, type: "LIVE_CLAIM", name: "Next week", status: "DRAFT", items: items(1) }]);
    const picker = await screen.findByRole("combobox", { name: "Round" });
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText(/use the admin API/)).toBeInTheDocument();
  });

  it("says so when there is no round", async () => {
    setup(meUser, []);
    expect(await screen.findByText(/no auction round yet/i)).toBeInTheDocument();
  });
});

