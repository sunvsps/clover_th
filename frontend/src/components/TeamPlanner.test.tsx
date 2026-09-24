import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamPlanner from "./TeamPlanner";
import { toGuildMember, toJob, type Me, type WireActivity, type WireEvent } from "../api";
import { toScheduleEvent } from "../api";
import { fakePlanner, meAdmin, meUser, wireJobs, wireMembers, type FakeLayout } from "../test/api";

// Monday 2026-09-21 10:00 Bangkok: "this week" for Tuesday is 2026-09-22 and for Sunday 2026-09-27.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const jobs = wireJobs.map(toJob);
const members = wireMembers.map(toGuildMember);
const activities: WireActivity[] = [
  { id: "guild-league", name: "Guild League", isGuild: true, hasPlanner: true, registrationCapacity: null, autoBackfill: true, layoutCapacity: 150 },
  { id: "polarity-zone", name: "Polarity Zone", isGuild: false, hasPlanner: true, registrationCapacity: null, autoBackfill: false, layoutCapacity: 50 },
  { id: "hazy-forest", name: "Hazy Forest", isGuild: false, hasPlanner: false, registrationCapacity: null, autoBackfill: false, layoutCapacity: 0 },
];
const wireEvents: WireEvent[] = [
  { id: "guild-league-tue-1", activityId: "guild-league", name: "Guild League", isGuild: true, dayOfWeek: 1, startTime: "21:30", endTime: "22:30" },
  { id: "polarity-zone", activityId: "polarity-zone", name: "Polarity Zone", isGuild: false, dayOfWeek: 6, startTime: "12:00", endTime: "21:00" },
  { id: "hazy-forest", activityId: "hazy-forest", name: "Hazy Forest", isGuild: false, dayOfWeek: 3, startTime: "21:30", endTime: "22:30" },
];
const events = wireEvents.map(toScheduleEvent);
const GUILD_LEAGUE: FakeLayout = [{ name: "Main", teams: 12 }, { name: "Sub", teams: 18 }];
const POLARITY: FakeLayout = [{ name: "Main", teams: 10 }];

function setup(me: Me, layout: FakeLayout, registered: string[] = [], opts: { autoBackfill?: boolean; isThai?: boolean } = {}) {
  const fake = fakePlanner({ me, layout, registered, autoBackfill: opts.autoBackfill });
  const notify = vi.fn();
  const user = userEvent.setup({ delay: null });
  const view = render(
    <TeamPlanner isThai={opts.isThai ?? false} isAdmin={me.isAdmin} jobs={jobs} members={members} events={events} activities={activities} onNotice={notify} />,
  );
  return { fake, notify, user, view };
}

const room = (name: string) => document.querySelector(`[data-room="${name}"]`) as HTMLElement;
const team = (name: string) => document.querySelector(`[data-team="${name}"]`) as HTMLElement;
const focusWindow = () => act(async () => void window.dispatchEvent(new Event("focus")));
const dt = (data: Record<string, string>) => ({ dataTransfer: { getData: (k: string) => data[k] ?? "", setData: vi.fn(), effectAllowed: "", dropEffect: "" } });

describe("TeamPlanner on the plan API", () => {
  it("the activity tabs list only activities that have a planner", async () => {
    setup(meUser, GUILD_LEAGUE);
    const tabs = await screen.findAllByRole("tab");
    const names = tabs.map((tab) => tab.textContent);
    expect(names).toEqual(["Guild League", "Polarity Zone"]);
    expect(names.join()).not.toMatch(/Hazy/);
  });

  it("Guild League shows Main with 60 slots and Sub with 90, in compact teams", async () => {
    setup(meUser, GUILD_LEAGUE);
    await waitFor(() => expect(room("Main")).toBeInTheDocument());
    expect(room("Main")).toHaveTextContent("0/60 slots · 12 teams");
    expect(room("Sub")).toHaveTextContent("0/90 slots · 18 teams");
    // an empty team is one compact line, not five empty rows
    expect(within(team("Main 1")).getAllByText(/free/)).toHaveLength(1);
    expect(team("Main 1").querySelectorAll(".subteam-slot")).toHaveLength(1);
  });

  it("asks for the Bangkok occurrence date and offers this week and the next two", async () => {
    const { fake, user } = setup(meUser, GUILD_LEAGUE);
    await waitFor(() => expect(fake.calls.some((c) => c.path.endsWith("/2026-09-22/plan"))).toBe(true));
    const select = await screen.findByLabelText("Date");
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Tue 22 Sep · 21:30", "Tue 29 Sep · 21:30", "Tue 6 Oct · 21:30"]);
    await user.selectOptions(select, "2026-09-29:guild-league-tue-1");
    await waitFor(() => expect(fake.calls.some((c) => c.path.endsWith("/2026-09-29/plan"))).toBe(true));
  });

  it("Polarity Zone shows 50 slots and a numbered reserves list in registration order", async () => {
    const { user } = setup(meUser, POLARITY, ["m-cleo", "m-bo", "m-dax"]);
    await user.click(await screen.findByRole("tab", { name: "Polarity Zone" }));
    await waitFor(() => expect(room("Main")).toHaveTextContent("0/50 slots"));
    const list = screen.getByRole("list", { name: /Reserves in registration order/ });
    const rows = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("#1Cleo");
    expect(rows[1]).toContain("#2Bo");
    expect(rows[2]).toContain("#3Dax");
  });

  it("a non-admin sees the plan but cannot drag, select, or use any edit control", async () => {
    const { fake } = setup(meUser, POLARITY, ["m-bo"]);
    fake.seedPlacement("m-cleo", "Main 1", 1);
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Cleo"));
    expect(screen.getByText("View only")).toBeInTheDocument();
    for (const chip of document.querySelectorAll(".member-chip")) {
      expect(chip).not.toHaveAttribute("draggable", "true");
      expect(chip).not.toHaveAttribute("role", "button");
    }
    expect(screen.queryByRole("button", { name: /Clear all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy from last week/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Cleo/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search members/)).not.toBeInTheDocument();
    expect(fake.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("an admin places a member by search, sending the version from the plan", async () => {
    const { fake, user } = setup(meAdmin, POLARITY, []);
    await user.click(await screen.findByRole("button", { name: "Add a member to Main 1 (5 free)" }));
    await user.type(screen.getByLabelText("Add member to Main 1"), "Cleo");
    await waitFor(() => expect(document.querySelector(".slot-matches")).toBeInTheDocument());
    await user.click(within(document.querySelector(".slot-matches") as HTMLElement).getByRole("button", { name: /Cleo/ }));
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Cleo"));
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toMatch(/plan\/placements\/m-cleo$/);
    expect(put.body).toEqual({ teamId: fake.teamId("Main 1"), expectedVersion: 0 });
    expect(team("Main 1")).toHaveTextContent("1/5");
  });

  it("drag and drop: onto a team = lowest free slot; onto a member = swap into that slot", async () => {
    const { fake, user } = setup(meAdmin, POLARITY, ["m-bo", "m-cleo"]);
    await screen.findByLabelText(/Reserves in registration order/);
    const bo = () => screen.getAllByTitle(/^Bo ·/)[0]!;
    fireEvent(bo(), createEvent.dragStart(bo(), dt({})));
    const start = createEvent.dragStart(bo(), dt({}));
    fireEvent(bo(), start);
    fireEvent(team("Main 1"), createEvent.drop(team("Main 1"), dt({ "text/guild-member": "m-bo" })));
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Bo"));
    expect(fake.calls.find((c) => c.method === "PUT")!.body).toEqual({ teamId: fake.teamId("Main 1"), expectedVersion: 0 });

    // drop Cleo (a reserve) on Bo's chip: Cleo takes slot 1
    const boChip = within(team("Main 1")).getByTitle(/^Bo ·/);
    fireEvent(boChip, createEvent.drop(boChip, dt({ "text/guild-member": "m-cleo" })));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(fake.calls.filter((c) => c.method === "PUT")[1]!.body).toEqual({ teamId: fake.teamId("Main 1"), slot: 1, expectedVersion: 1 });
    await waitFor(() => expect(within(team("Main 1")).getAllByTitle(/·/)[0]).toHaveAttribute("title", expect.stringMatching(/^Cleo/)));
    void user;
  });

  it("tap a member, then tap a team (phones and tablets); a placed member can be removed", async () => {
    const { fake, user } = setup(meAdmin, POLARITY, ["m-bo"]);
    const reserves = await screen.findByLabelText(/Reserves in registration order/);
    await user.click(within(reserves).getByTitle(/^Bo ·/));
    expect(screen.getByText(/Bo selected/)).toBeInTheDocument();
    await user.click(team("Main 2"));
    await waitFor(() => expect(team("Main 2")).toHaveTextContent("Bo"));
    expect(fake.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ teamId: fake.teamId("Main 2") });
    await user.click(within(team("Main 2")).getByRole("button", { name: "Remove Bo from the team" }));
    await waitFor(() => expect(team("Main 2")).not.toHaveTextContent("Bo"));
    expect(fake.calls.filter((c) => c.method === "PUT")[1]!.body).toEqual({ teamId: null, expectedVersion: 1 });
  });

  it("flags placed members who are not registered, waitlisted or on leave", async () => {
    const { fake } = setup(meUser, POLARITY);
    fake.seedPlacement("m-bo", "Main 1", 1, "NONE");
    fake.seedPlacement("m-cleo", "Main 1", 2, "LEAVE");
    fake.seedPlacement("m-dax", "Main 1", 3, "WAITLISTED");
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Dax"));
    expect(team("Main 1")).toHaveTextContent("Not registered");
    expect(team("Main 1")).toHaveTextContent("On leave");
    expect(team("Main 1")).toHaveTextContent("Waitlisted");
  });

  it("a stale-version write shows the conflict message, refetches, and keeps the selection", async () => {
    const { fake, user, notify } = setup(meAdmin, POLARITY, ["m-bo"]);
    const reserves = await screen.findByLabelText(/Reserves in registration order/);
    fake.externalPlace("m-dax", "Main 1", 1); // someone else changed the plan (version 0 -> 1)
    await user.click(within(reserves).getByTitle(/^Bo ·/));
    await user.click(team("Main 2"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("The plan was changed by someone else. It has been reloaded; please try again."));
    expect(fake.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ expectedVersion: 0 });
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Dax")); // the refetch brought the other change in
    expect(team("Main 2")).not.toHaveTextContent("Bo");
    expect(screen.getByText(/Bo selected/)).toBeInTheDocument(); // still selected: retry with one tap
    await user.click(team("Main 2"));
    await waitFor(() => expect(team("Main 2")).toHaveTextContent("Bo"));
    expect(fake.calls.filter((c) => c.method === "PUT")[1]!.body).toMatchObject({ expectedVersion: 1 });
  });

  it("an auto-promotion made by someone else shows the badge and a toast; Undo returns the member to the reserves in the same position", async () => {
    const { fake, user, notify } = setup(meAdmin, POLARITY, ["m-bo", "m-cleo", "m-dax"], { autoBackfill: true });
    fake.seedPlacement("m-bo", "Main 1", 1);
    await screen.findByLabelText(/Reserves in registration order/);
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Bo"));
    // Bo withdraws elsewhere; the backend places the first reserve (Cleo) into the slot
    fake.externalBackfill("m-bo", "m-cleo");
    await focusWindow();
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Cleo"));
    expect(team("Main 1")).toHaveTextContent("Auto-promoted from reserve, replaced Bo");
    expect(notify).toHaveBeenCalledWith("Cleo was auto-promoted from reserve into Main 1, replacing Bo.");
    const reserves = screen.getByRole("list", { name: /Reserves in registration order/ });
    expect(within(reserves).getAllByRole("listitem")[0]).toHaveTextContent("#1Dax"); // Cleo left the reserves

    await user.click(screen.getByRole("button", { name: "Undo auto-promotion of Cleo" }));
    await waitFor(() => expect(team("Main 1")).not.toHaveTextContent("Cleo"));
    expect(fake.calls.find((c) => c.path.endsWith("/undo-backfill"))!.body).toEqual({ expectedVersion: 1 });
    // Cleo registered before Dax, so she is reserve #1 again
    await waitFor(() => expect(within(screen.getByRole("list", { name: /Reserves in registration order/ })).getAllByRole("listitem")[0]).toHaveTextContent("#1Cleo"));
  });

  it("a non-admin sees the auto-promotion badge but no Undo", async () => {
    const { fake } = setup(meUser, POLARITY, ["m-bo", "m-cleo"], { autoBackfill: true });
    fake.seedPlacement("m-bo", "Main 1", 1);
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Bo"));
    fake.externalBackfill("m-bo", "m-cleo");
    await focusWindow();
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Auto-promoted from reserve"));
    expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  });

  it("polls the plan every 5 seconds while open", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-21T03:00:00Z"));
    const { fake } = setup(meUser, POLARITY, ["m-bo"]);
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(1));
    const before = fake.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5100));
    await waitFor(() => expect(fake.calls.length).toBeGreaterThan(before));
  });

  it("copy-from-previous posts the version and reports the result; clear asks for confirmation first", async () => {
    const { fake, user, notify } = setup(meAdmin, POLARITY, ["m-bo"]);
    fake.seedPlacement("m-cleo", "Main 1", 1);
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Cleo"));
    await user.click(screen.getByRole("button", { name: /Copy from last week/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Copied 3 placements from 2026-09-15 (1 skipped)."));
    expect(fake.calls.find((c) => c.path.endsWith("/copy-from-previous"))!.body).toEqual({ expectedVersion: 0 });

    await user.click(screen.getByRole("button", { name: /Clear all/ }));
    const banner = screen.getByRole("alertdialog");
    expect(banner).toHaveTextContent("Remove all 1 placements");
    await user.click(within(banner).getByRole("button", { name: "Cancel" }));
    expect(fake.calls.some((c) => c.path.endsWith("/clear"))).toBe(false);
    await user.click(screen.getByRole("button", { name: /Clear all/ }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear plan" }));
    await waitFor(() => expect(team("Main 1")).not.toHaveTextContent("Cleo"));
    expect(fake.calls.find((c) => c.path.endsWith("/clear"))!.body).toEqual({ expectedVersion: 0 });
  });

  it("shows a layout change correctly: a removed team that still holds people is marked", async () => {
    const { fake } = setup(meUser, [{ name: "Main", teams: 1 }, { name: "Old", teams: 1, archived: true }]);
    fake.seedPlacement("m-bo", "Old 1", 1);
    await waitFor(() => expect(team("Old 1")).toBeInTheDocument());
    expect(team("Old 1")).toHaveTextContent("removed");
    expect(room("Old")).toHaveTextContent("/0 slots"); // removed teams do not count as capacity
  });

  it("error codes are translated (Thai)", async () => {
    const { user, notify } = setup(meAdmin, [{ name: "Main", teams: 1, size: 1 }], ["m-bo", "m-cleo"], { isThai: true });
    const fakeless = notify;
    const reserves = await screen.findByLabelText(/รายชื่อสำรองตามลำดับลงทะเบียน/);
    await user.click(within(reserves).getByTitle(/^Bo ·/));
    await user.click(team("Main 1"));
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Bo"));
    await user.click(within(screen.getByLabelText(/รายชื่อสำรองตามลำดับลงทะเบียน/)).getByTitle(/^Cleo ·/));
    await user.click(team("Main 1"));
    await waitFor(() => expect(fakeless).toHaveBeenCalledWith("ทีมนี้เต็มแล้ว"));
  });

  it("copy output uses ign and lists reserves in order", async () => {
    const { fake, user } = setup(meUser, POLARITY, ["m-bo", "m-dax"]);
    fake.seedPlacement("m-cleo", "Main 1", 1);
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await waitFor(() => expect(team("Main 1")).toHaveTextContent("Cleo"));
    await user.click(screen.getByRole("button", { name: /Copy plan/ }));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("Main 1: Cleo (Wizard)");
    expect(text).toContain("Reserves (2)");
    expect(text).toMatch(/1\. Bo\n\s+2\. Dax/);
    expect(text).not.toMatch(/m-(bo|cleo|dax)/);
  });
});

describe("job chart (kept, no manager here)", () => {
  it("shows members per job but no job manager: that lives in Admin > Jobs now", async () => {
    setup(meAdmin, POLARITY);
    const card = document.querySelector(".chart-card") as HTMLElement;
    expect(within(card).getAllByText("High Priest").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Manage jobs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit jobs/ })).not.toBeInTheDocument();
  });
});
