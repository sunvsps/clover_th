import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklySchedule from "./WeeklySchedule";
import { toGuildMember, toJob, toScheduleEvent, type Me } from "../api";
import { fakeRegistrations, meAdmin, meUser, wireActivities, wireEvents, wireJobs, wireMembers } from "../test/api";

// Monday 2026-09-21 10:00 Bangkok. Wednesday's "Guild War" (20:00) is still open; Saturday's "Boss Hunt" too.
const MONDAY = "2026-09-21T03:00:00Z";
const WED = "2026-09-23:e-1";
const SAT = "2026-09-26:e-2";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MONDAY));
});
afterEach(() => vi.useRealTimers());

const jobs = wireJobs.map(toJob);
const members = wireMembers.map(toGuildMember);
const events = wireEvents.map(toScheduleEvent);

function setup(me: Me, opts: { capacity?: Record<string, number>; planner?: boolean; failWith?: string } = {}) {
  const fake = fakeRegistrations({
    me,
    capacity: opts.capacity,
    planner: opts.planner ? new Set(["a-1"]) : undefined,
    failWith: opts.failWith,
  });
  const notify = vi.fn();
  const user = userEvent.setup({ delay: null });
  const view = render(
    <WeeklySchedule isThai={false} memberId={me.memberId} isAdmin={me.isAdmin} events={events} jobs={jobs} members={members} activities={wireActivities} onNotice={notify} />,
  );
  return { fake, notify, user, view };
}

const openEvent = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  await user.click(await screen.findByTitle(title));
  return screen.getByRole("dialog");
};
const WAR = "Guild War 20:00-21:00";
const HUNT = "Boss Hunt 19:30-20:30";

describe("WeeklySchedule on the API", () => {
  it("asks for the Bangkok Monday-Sunday week", async () => {
    const { fake } = setup(meUser);
    await screen.findByTitle(WAR);
    await waitFor(() => expect(fake.gets.length).toBeGreaterThan(0));
    expect(fake.gets[0]).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("a member sets joined, leave and none, and the roster updates each time (PUT .../registrations/me)", async () => {
    const { fake, user } = setup(meUser);
    const dialog = await openEvent(user, WAR);
    await user.click(within(dialog).getByRole("button", { name: /I'm playing/ }));
    const playing = () => dialog.querySelector('[data-roster="joined"]') as HTMLElement;
    const onLeave = () => dialog.querySelector('[data-roster="leave"]') as HTMLElement;
    await waitFor(() => expect(playing()).toHaveTextContent("Bo"));
    expect(fake.puts[0]).toMatchObject({ url: expect.stringMatching(/\/events\/e-1\/occurrences\/2026-09-23\/registrations\/me$/), body: { status: "JOINED" }, xrw: "clover-web" });

    await user.click(within(dialog).getByRole("button", { name: /Mark leave/ }));
    await waitFor(() => expect(onLeave()).toHaveTextContent("Bo"));
    expect(playing()).not.toHaveTextContent("Bo");
    expect(fake.puts[1]!.body).toEqual({ status: "LEAVE" });

    await user.click(within(dialog).getByRole("button", { name: /Clear$/ }));
    await waitFor(() => expect(onLeave()).not.toHaveTextContent("Bo"));
    expect(fake.puts[2]!.body).toEqual({ status: "NONE" });
    expect(within(dialog).getByText(/Not set/)).toBeInTheDocument();
  });

  it("with a capacity, the extra registrant is waitlisted with a position; a promotion appears after an unregister", async () => {
    const { fake, user, notify } = setup(meUser, { capacity: { "a-2": 1 } });
    fake.seed(SAT, "m-cleo", "JOINED");
    const dialog = await openEvent(user, HUNT);
    expect(within(dialog).getByText(/Capacity/).parentElement).toHaveTextContent("1/1");
    await user.click(within(dialog).getByRole("button", { name: /I'm playing/ }));
    await waitFor(() => expect(within(dialog).getByText(/Waitlist #1/)).toBeInTheDocument());
    expect(notify).toHaveBeenCalledWith("The activity is full: you are on the waitlist at #1.");
    expect(dialog.querySelector('[data-roster="waitlisted"]')).toHaveTextContent("#1");

    // Cleo unregisters elsewhere; the next poll / window focus shows my promotion
    fake.externalUnregister(SAT, "e-2", "m-cleo");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(within(dialog).getByText(/Playing/, { selector: "strong" })).toBeInTheDocument());
    expect(notify).toHaveBeenCalledWith("You were moved up from the waitlist for Boss Hunt 2026-09-26.");
  });

  it("an admin unregistering a member promotes the waitlist and says so", async () => {
    const { fake, user, notify } = setup(meAdmin, { capacity: { "a-2": 1 } });
    fake.seed(SAT, "m-cleo", "JOINED");
    fake.seed(SAT, "m-dax", "WAITLISTED");
    const dialog = await openEvent(user, HUNT);
    await user.click(await within(dialog).findByRole("button", { name: "Clear Cleo" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Cleo cleared the registration."));
    expect(notify).toHaveBeenCalledWith("Dax was moved up from the waitlist.");
    expect(fake.puts[0]!.url).toMatch(/registrations\/m-cleo$/);
    await waitFor(() => expect(dialog.querySelector('[data-roster="joined"]')).toHaveTextContent("Dax"));
  });

  it("a non-admin gets no controls for other members", async () => {
    const { fake, user } = setup(meUser);
    fake.seed(WED, "m-cleo", "JOINED");
    const dialog = await openEvent(user, WAR);
    await waitFor(() => expect(dialog).toHaveTextContent("Cleo"));
    expect(within(dialog).queryByRole("button", { name: "Clear Cleo" })).not.toBeInTheDocument();
    expect(within(dialog).queryByPlaceholderText(/member name/)).not.toBeInTheDocument();
    expect(fake.puts).toHaveLength(0);
  });

  it("an admin can record for another member with that member's id", async () => {
    const { fake, user } = setup(meAdmin);
    const dialog = await openEvent(user, WAR);
    await user.type(within(dialog).getByPlaceholderText(/member name/), "Dax");
    await user.click(within(dialog).getByRole("button", { name: /^Dax/ }));
    await user.click(within(dialog).getByRole("button", { name: /^Playing$/ }));
    await waitFor(() => expect(fake.puts).toHaveLength(1));
    expect(fake.puts[0]!.url).toMatch(/registrations\/m-dax$/);
    await waitFor(() => expect(dialog.querySelector('[data-roster="joined"]')).toHaveTextContent("Dax"));
  });

  it("after the occurrence starts the buttons are disabled for a member but not for an admin", async () => {
    vi.setSystemTime(new Date("2026-09-23T14:00:00Z")); // Wed 21:00 Bangkok, the war started at 20:00
    const member = setup(meUser);
    let dialog = await openEvent(member.user, WAR);
    expect(within(dialog).getByText(/Registration closed/)).toBeInTheDocument();
    for (const name of [/I'm playing/, /Mark leave/]) expect(within(dialog).getByRole("button", { name })).toBeDisabled();
    member.view.unmount();

    const admin = setup(meAdmin);
    dialog = await openEvent(admin.user, WAR);
    expect(within(dialog).getByRole("button", { name: /I'm playing/ })).toBeEnabled();
  });

  it("shows Placed and Reserve #n for a planner activity", async () => {
    const { fake, user } = setup(meUser, { planner: true });
    fake.seed(WED, "m-cleo", "JOINED", { placed: true });
    fake.seed(WED, "m-dax", "JOINED");
    fake.seed(WED, "m-aria", "JOINED");
    const dialog = await openEvent(user, WAR);
    const playing = await waitFor(() => {
      const el = dialog.querySelector('[data-roster="joined"]') as HTMLElement;
      expect(el).toHaveTextContent("Placed");
      return el;
    });
    expect(playing).toHaveTextContent("Cleo · Placed");
    expect(playing).toHaveTextContent("Dax · Reserve #1");
    expect(playing).toHaveTextContent("Aria · Reserve #2");
  });

  it("copy output lists ign (never ids), with waitlist and leave", async () => {
    const { fake, user } = setup(meAdmin, { capacity: { "a-2": 1 } });
    fake.seed(SAT, "m-cleo", "JOINED");
    fake.seed(SAT, "m-dax", "WAITLISTED");
    fake.seed(SAT, "m-bo", "LEAVE");
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await screen.findByTitle(HUNT);
    await waitFor(() => expect(screen.getAllByText(/Cleo/).length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: /Copy roster/ }));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("Playing: Cleo");
    expect(text).toContain("Waitlist: 1. Dax");
    expect(text).toContain("Leave: Bo");
    expect(text).not.toMatch(/m-(cleo|dax|bo)/);
  });

  it("shows API errors as a translated notice and refreshes", async () => {
    const { user, notify } = setup(meUser, { failWith: "REGISTRATION_CLOSED" });
    const dialog = await openEvent(user, WAR);
    await user.click(within(dialog).getByRole("button", { name: /I'm playing/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Registration is closed: the activity has already started."));
  });

  it("switching to Thai translates the dialog and the error text", async () => {
    const fake = fakeRegistrations({ me: meUser, failWith: "TEAM_FULL" });
    void fake;
    const notify = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<WeeklySchedule isThai memberId={meUser.memberId} isAdmin={false} events={events} jobs={jobs} members={members} activities={wireActivities} onNotice={notify} />);
    const dialog = await openEvent(user, WAR);
    await user.click(within(dialog).getByRole("button", { name: /ลงทะเบียนเล่น/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("ทีมนี้เต็มแล้ว"));
  });
});
