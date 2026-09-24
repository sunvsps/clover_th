import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QueueView from "./QueueView";
import { serverClock, toGuildMember, toJob } from "../api";
import { fakeAuctions, meAdmin, meUser, wireJobs, wireMembers, type FakeQueueWin, type FakeRound } from "../test/api";
import type { Me } from "../api";

const SERVER = Date.parse("2026-09-21T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const members = wireMembers.map(toGuildMember);
const jobs = wireJobs.map(toJob);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SERVER));
});
afterEach(() => {
  vi.useRealTimers();
  serverClock.reset();
});

function setup(me: Me, opts: { rounds?: FakeRound[]; queues?: Record<string, string[]>; history?: FakeQueueWin[]; isThai?: boolean } = {}) {
  const fake = fakeAuctions({ me, rounds: opts.rounds ?? [], serverNow: () => SERVER, queues: opts.queues, history: opts.history });
  const notify = vi.fn();
  const onGoToAuction = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<QueueView isThai={opts.isThai ?? false} isAdmin={me.isAdmin} memberId={me.memberId} members={members} jobs={jobs} notify={notify} onGoToAuction={onGoToAuction} />);
  return { fake, notify, onGoToAuction, user };
}
const column = async (category: string, text: string) =>
  waitFor(() => {
    const el = document.querySelector(`[data-queue="${category}"]`) as HTMLElement;
    expect(el).toHaveTextContent(text);
    return el;
  });

describe("queue page", () => {
  it("lists each queue in order with job, lets me join and leave (upper-case category on the wire)", async () => {
    const { fake, user, notify } = setup(meUser, { queues: { GEAR: ["m-cleo"] } });
    const gear = await column("gear", "Cleo");
    expect(gear).toHaveTextContent("Wizard"); // Cleo's job
    expect(gear).toHaveTextContent("1 in queue");
    await user.click(within(gear).getByRole("button", { name: /Join queue/ }));
    await waitFor(() => expect(gear).toHaveTextContent("You are #2"));
    expect(fake.calls.find((c) => c.method === "PUT")!.path).toMatch(/queues\/GEAR\/me$/);
    expect(notify).toHaveBeenCalledWith("You joined the Gear queue.");
    expect(within(gear).getAllByRole("listitem").map((li) => li.className)).toEqual(["", "mine"]);
    await user.click(within(gear).getByRole("button", { name: /Leave/ }));
    await waitFor(() => expect(gear).not.toHaveTextContent("You are #"));
    expect(fake.calls.some((c) => c.method === "DELETE" && /queues\/GEAR\/me$/.test(c.path))).toBe(true);
  });

  it("members see no remove button", async () => {
    setup(meUser, { queues: { CARD: ["m-cleo"] } });
    const asMember = await column("card", "Cleo");
    expect(within(asMember).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("an admin removes a member from one queue", async () => {
    const { fake, user, notify } = setup(meAdmin, { queues: { CARD: ["m-cleo", "m-dax"] } });
    const card = await column("card", "Dax");
    await user.click(within(card).getByRole("button", { name: "Remove Cleo" }));
    await waitFor(() => expect(card).not.toHaveTextContent("Cleo"));
    expect(fake.calls.find((c) => c.method === "DELETE")!.path).toMatch(/admin\/auctions\/queues\/CARD\/m-cleo$/);
    expect(notify).toHaveBeenCalledWith("Cleo was removed from the Card queue.");
  });

  it("an open ranked queue round highlights its categories and links eligible members to the auction page", async () => {
    const round: FakeRound = {
      id: 7, type: "QUEUE_RANKED", name: "Weekly drops", status: "OPEN", opensAt: iso(SERVER - 1000), closesAt: iso(SERVER + 600_000),
      items: [{ id: 1, name: "Helm", category: "GEAR" }, { id: 2, name: "Armor", category: "GEAR" }], eligible: ["GEAR"],
    };
    const { user, onGoToAuction } = setup(meUser, { rounds: [round], queues: { GEAR: ["m-bo"], CARD: ["m-bo"] } });
    const gear = await column("gear", "2 in the open round");
    expect(gear).toHaveClass("live");
    expect(await column("card", "You are #1")).not.toHaveClass("live");
    await user.click(within(gear).getByRole("button", { name: /rank your items/ }));
    expect(onGoToAuction).toHaveBeenCalled();
  });

  it("someone who joined after the round opened is told they count from the next round", async () => {
    const round: FakeRound = {
      id: 7, type: "QUEUE_RANKED", name: "Weekly drops", status: "OPEN", opensAt: iso(SERVER - 1000), closesAt: iso(SERVER + 600_000),
      items: [{ id: 1, name: "Helm", category: "GEAR" }], eligible: [],
    };
    setup(meUser, { rounds: [round], queues: { GEAR: ["m-bo"] } });
    const gear = await column("gear", "1 in the open round");
    await waitFor(() => expect(gear).toHaveTextContent("count from the next one"));
    expect(within(gear).queryByRole("button", { name: /rank your items/ })).not.toBeInTheDocument();
  });

  it("shows the queue win history with round, item, category, winner and queue position", async () => {
    const history: FakeQueueWin[] = [
      { roundId: 3, roundName: "Weekly drops", itemId: 11, itemName: "Poring Card", category: "CARD", memberId: "m-dax", queuePos: 2, wonAt: iso(SERVER - 3600_000) },
    ];
    const { fake } = setup(meUser, { history });
    const box = await screen.findByTestId("queue-history");
    await waitFor(() => expect(box).toHaveTextContent("Poring Card"));
    expect(box).toHaveTextContent("R03");
    expect(box).toHaveTextContent("Card · Weekly drops");
    expect(box).toHaveTextContent("Dax #2");
    expect(box).toHaveTextContent("Won");
    expect(box).not.toHaveTextContent("Passed");
    expect(fake.calls.find((c) => c.path.startsWith("/api/v1/auctions/queues/history"))!.path).toContain("limit=40");
  });

  it("says so when there is no history yet (Thai)", async () => {
    setup(meUser, { isThai: true });
    const box = await screen.findByTestId("queue-history");
    await waitFor(() => expect(box).toHaveTextContent("ยังไม่มีรายการ"));
    expect(screen.getByRole("heading", { name: "จองคิวประมูล" })).toBeInTheDocument();
  });
});
