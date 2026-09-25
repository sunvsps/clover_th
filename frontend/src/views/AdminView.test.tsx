import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import AdminView from "./AdminView";
import { toGuildMember, toJob, type Me, type WireActivity } from "../api";
import { useGuildState } from "../hooks/useGuildState";
import { fakeAdmin, meAdmin, meUser, mockApi, wireJobs, wireMembers } from "../test/api";

const activities: WireActivity[] = [
  { id: "guild-league", name: "Guild League", isGuild: true, hasPlanner: true, registrationCapacity: null, autoBackfill: false, notifyChannelId: null, layoutCapacity: 10 },
  { id: "hazy-forest", name: "Hazy Forest", isGuild: false, hasPlanner: false, registrationCapacity: null, autoBackfill: false, notifyChannelId: null, layoutCapacity: 0 },
];

function Harness({ notify }: { notify: (m: string) => void }) {
  const guild = useGuildState({ initialMembers: wireMembers.map(toGuildMember), initialJobs: wireJobs.map(toJob), initialActivities: activities, isThai: false, notify });
  return (
    <AdminView isThai={false} jobs={guild.jobs} members={guild.members} activities={guild.activities} onSaveJobs={guild.saveJobs} onMembersChanged={() => {}} onActivityChanged={guild.updateActivity} notify={notify} />
  );
}

function setup(me: Me, opts: Parameters<typeof fakeAdmin>[0] extends infer O ? Partial<Omit<O & object, "me">> : never = {}) {
  const fake = fakeAdmin({ me, ...opts });
  const notify = vi.fn();
  const user = userEvent.setup({ delay: null });
  const view = render(<Harness notify={notify} />);
  return { fake, notify, user, view };
}
const tab = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole("tab", { name }));

beforeEach(() => {
  window.location.hash = "";
});

describe("who can see the admin page", () => {
  it("a non-admin has no Admin tab, and #admin falls back to the auction page", async () => {
    window.location.hash = "#admin";
    mockApi({ me: meUser });
    render(<App />);
    await screen.findByRole("navigation", { name: "Guild tools" });
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
  });

  it("an admin has the Admin tab and gets the page", async () => {
    mockApi({ me: meAdmin });
    fakeAdmin({ me: meAdmin });
    render(<App />);
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: "Admin" }));
    expect(await screen.findByTestId("admin-page")).toBeInTheDocument();
  });

  it("if the server refuses (ADMIN_REQUIRED) the page shows the message instead of failing", async () => {
    const { user } = setup(meUser); // the fake API answers 403 to a non-admin
    await tab(user, "Members");
    expect(await screen.findByRole("alert")).toHaveTextContent("Only admins can do this.");
  });

  it("there is no way to grant admin or to add or delete a member, on any tab", async () => {
    const { user } = setup(meAdmin);
    for (const name of ["Auctions", "Members", "Activities", "Team layout", "Jobs", "Notifications", "Audit log"]) {
      await tab(user, name);
      await waitFor(() => expect(document.querySelector("[data-admin]")).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 30)); // let the tab's data load, so its rows are checked too
      const controls = [...document.querySelectorAll("button, a, [role=button], label, option")].map((e) => e.textContent ?? "");
      for (const text of controls) expect(text).not.toMatch(/add member|new member|delete member|grant|make admin|promote to admin|remove admin/i);
    }
    await tab(user, "Members");
    await screen.findByText("Aria");
    expect(screen.getByText(/Admin/, { selector: ".admin-badge" })).toBeInTheDocument(); // a read-only badge
    expect(document.querySelector('input[type=checkbox][aria-label*="admin" i]')).toBeNull();
  });
});

describe("members", () => {
  it("edits the nickname (PATCH with the member id), shows the incomplete flag, and filters", async () => {
    const { fake, user, notify } = setup(meAdmin);
    await tab(user, "Members");
    const row = await screen.findByText("Bo").then((e) => e.closest("li") as HTMLElement);
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    await user.type(within(row).getByLabelText("Nickname"), "Bobo");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Member saved."));
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toMatch(/admin\/members\/m-bo$/);
    expect(patch.body).toMatchObject({ nickname: "Bobo", ign: "Bo" });
    expect(await screen.findByText(/Bobo/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete data/)).toBeInTheDocument(); // Dax
    await user.click(screen.getByLabelText("Incomplete only"));
    await waitFor(() => expect(fake.calls.some((c) => c.query?.incomplete === "1")).toBe(true));
  });

  it("deactivate keeps the member visible only with 'include deactivated'; an admin cannot deactivate themselves", async () => {
    const { fake, user } = setup(meAdmin);
    await tab(user, "Members");
    const own = await screen.findByText("Aria").then((e) => e.closest("li") as HTMLElement);
    await user.click(within(own).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot deactivate your own account.");
    await new Promise((r) => setTimeout(r, 80)); // the reload that follows must not wipe the message
    expect(screen.getByRole("alert")).toHaveTextContent("You cannot deactivate your own account.");
    const bo = screen.getByText("Bo").closest("li") as HTMLElement;
    await user.click(within(bo).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.queryByText("Bo")).not.toBeInTheDocument());
    await user.click(screen.getByLabelText("Include deactivated"));
    const back = await screen.findByText("Bo").then((e) => e.closest("li") as HTMLElement);
    expect(back).toHaveTextContent("Deactivated");
    await user.click(within(back).getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(fake.members.find((m) => m.ign === "Bo")!.isActive).toBe(true));
  });

  it("a duplicate in-game name shows the translated error", async () => {
    const { user } = setup(meAdmin);
    await tab(user, "Members");
    const row = await screen.findByText("Bo").then((e) => e.closest("li") as HTMLElement);
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const ign = within(row).getByLabelText("In-game name");
    await user.clear(ign);
    await user.type(ign, "aria");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That in-game name is already used by another member.");
  });
});

describe("activities", () => {
  it("saves capacity and auto-backfill; auto-backfill is unavailable without a planner; a promotion is reported", async () => {
    const { fake, user, notify } = setup(meAdmin);
    await tab(user, "Activities");
    await user.type(await screen.findByLabelText("Guild League capacity"), "3");
    await user.click(screen.getByLabelText("Guild League auto-backfill"));
    await user.type(screen.getByLabelText("Guild League notification channel"), "123456");
    await user.click(screen.getByRole("button", { name: "Save Guild League" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Guild League saved. 1 waitlisted members were moved up."));
    expect(fake.calls.find((c) => c.method === "PATCH")!.body).toEqual({ registrationCapacity: 3, autoBackfill: true, notifyChannelId: "123456" });
    expect(screen.getByLabelText("Hazy Forest auto-backfill")).toBeDisabled();
    expect(screen.getByText(/needs a team planner/)).toBeInTheDocument();
  });

  it("clearing the capacity sends null (no limit)", async () => {
    const { fake, user } = setup(meAdmin);
    await tab(user, "Activities");
    const cap = await screen.findByLabelText("Guild League capacity");
    await user.type(cap, "5");
    await user.clear(cap);
    await user.click(screen.getByLabelText("Guild League auto-backfill")); // a change so Save is enabled
    await user.click(screen.getByRole("button", { name: "Save Guild League" }));
    await waitFor(() => expect(fake.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ registrationCapacity: null }));
  });
});

describe("team layout", () => {
  it("loads the layout, saves an edit with the ids of existing rooms and teams", async () => {
    const { fake, user, notify } = setup(meAdmin);
    await tab(user, "Team layout");
    const size = await screen.findByLabelText("Main team 1 size");
    await user.clear(size);
    await user.type(size, "6");
    await user.click(screen.getByRole("button", { name: "Add team" }));
    await user.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Layout saved."));
    const put = fake.calls.find((c) => c.method === "PUT")!;
    const room = (put.body as { rooms: { id: number; key: string; teams: { id?: number; size: number }[] }[] }).rooms[0]!;
    expect(room).toMatchObject({ id: 1, key: "main" });
    expect(room.teams.map((t) => [t.id, t.size])).toEqual([[11, 6], [12, 5], [undefined, 5]]);
  });

  it("LAYOUT_BELOW_PLACED names the team, the placed slot and the new size", async () => {
    const { user } = setup(meAdmin, { layoutViolation: [{ teamId: 11, placed: 5, size: 3 }] });
    await tab(user, "Team layout");
    const size = await screen.findByLabelText("Main team 1 size");
    await user.clear(size);
    await user.type(size, "3");
    await user.click(screen.getByRole("button", { name: "Save layout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The change would leave placed members without a slot: Main 1 still has a member in slot 5 but its new size is 3. Move them first.");
  });
});

describe("jobs", () => {
  it("a rename is saved through PUT /admin/jobs (existing ids kept, new job without id) and the list updates", async () => {
    const { fake, user, notify } = setup(meAdmin);
    await tab(user, "Jobs");
    await user.click(await screen.findByRole("button", { name: /Manage jobs/ }));
    const dialog = screen.getByRole("dialog");
    const names = within(dialog).getAllByLabelText("Job name");
    await user.clear(names[1]!);
    await user.type(names[1]!, "Crusader");
    await user.type(within(dialog).getByPlaceholderText("New job name"), "Bard");
    await user.click(within(dialog).getByRole("button", { name: /Add to list/ }));
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const jobs = (fake.calls.find((c) => c.method === "PUT")!.body as { jobs: { id?: number; label: string }[] }).jobs;
    expect(jobs[1]).toMatchObject({ id: 2, label: "Crusader" });
    expect(jobs.at(-1)).toMatchObject({ label: "Bard" });
    expect(jobs.at(-1)!.id).toBeUndefined();
    expect(notify).toHaveBeenCalledWith("Job list saved.");
    expect(screen.getByText("Crusader")).toBeInTheDocument();
    expect(screen.getByText("Bard")).toBeInTheDocument();
  });

  it("a duplicate label found by the server is shown in the dialog and the draft stays open", async () => {
    const { user } = setup(meAdmin, { duplicateLabel: "Taken" });
    await tab(user, "Jobs");
    await user.click(await screen.findByRole("button", { name: /Manage jobs/ }));
    const dialog = screen.getByRole("dialog");
    const names = within(dialog).getAllByLabelText("Job name");
    await user.clear(names[0]!);
    await user.type(names[0]!, "Taken");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A job with that name already exists.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("notifications", () => {
  it("lists them with counts, and a DEAD one can be retried", async () => {
    const { fake, user, notify } = setup(meAdmin, { notifications: [{ id: 1, status: "SENT" }, { id: 2, status: "DEAD" }] });
    await tab(user, "Notifications");
    const dead = await screen.findByText(/#2/).then((e) => e.closest("li") as HTMLElement);
    expect(dead).toHaveTextContent("Failed");
    expect(dead).toHaveTextContent("Cannot send messages to this user");
    expect(screen.getByText(/Failed 1/)).toBeInTheDocument();
    expect(within(screen.getByText(/#1/).closest("li") as HTMLElement).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    await user.click(within(dead).getByRole("button", { name: "Retry notification 2" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Notification #2 queued to be sent again."));
    expect(fake.calls.find((c) => c.path.endsWith("/notifications/2/retry"))!.method).toBe("POST");
    await waitFor(() => expect(fake.notifications[1]!.status).toBe("PENDING"));
  });

  it("the status filter goes to the API", async () => {
    const { fake, user } = setup(meAdmin, { notifications: [{ id: 1, status: "SENT" }, { id: 2, status: "DEAD" }] });
    await tab(user, "Notifications");
    await user.selectOptions(await screen.findByLabelText("Status"), "dead");
    await waitFor(() => expect(fake.calls.some((c) => c.query?.status === "DEAD")).toBe(true));
  });
});

describe("audit log", () => {
  it("shows entries with the actor's name, pages with the cursor and filters by action", async () => {
    const { fake, user } = setup(meAdmin, { audit: [{ id: 5, action: "plan.place" }, { id: 4, action: "plan.clear" }, { id: 3, action: "plan.place" }] });
    await tab(user, "Audit log");
    await screen.findByText("plan.clear");
    expect(screen.getAllByText(/Aria/).length).toBeGreaterThan(0); // actor shown by ign
    expect(screen.queryByText(/m-aria/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(document.querySelectorAll("[data-audit]")).toHaveLength(3));
    expect(fake.calls.some((c) => c.query?.cursor === "4")).toBe(true);
    await user.type(screen.getByLabelText("Action"), "plan.clear");
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(document.querySelectorAll("[data-audit]")).toHaveLength(1));
  });
});

describe("auction management", () => {
  const draftRound = { id: 1, type: "LIVE_CLAIM" as const, name: "Old draft", status: "DRAFT" as const, durationSec: 300, winCap: 5, startDelaySec: 3, items: [{ id: 1, name: "Pet 1", category: "PET", rarity: null, imageUrl: null }] };

  it("creates a round as a draft (auto-generated items) and then starts it", async () => {
    const { fake, user, notify } = setup(meAdmin);
    await screen.findByRole("button", { name: "New round" });
    await user.click(screen.getByRole("button", { name: "New round" }));
    await user.type(screen.getByLabelText("Name"), "Friday drops");
    await user.click(screen.getByRole("button", { name: "Create round" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Round created as a draft. Start it when you are ready."));
    const post = fake.calls.find((c) => c.method === "POST" && c.path.endsWith("/admin/auctions/rounds"))!;
    expect(post.body).toMatchObject({ type: "LIVE_CLAIM", name: "Friday drops", durationSec: 300, startDelaySec: 3 });
    expect((post.body as { items: { name: string; category?: string }[] }).items).toEqual([
      { name: "Item 1", category: null, rarity: null, imageUrl: null, disabled: false },
      { name: "Item 2", category: null, rarity: null, imageUrl: null, disabled: false },
      { name: "Item 3", category: null, rarity: null, imageUrl: null, disabled: false },
      { name: "Item 4", category: null, rarity: null, imageUrl: null, disabled: false },
    ]);
    const row = await screen.findByText(/Friday drops/).then((e) => e.closest("li") as HTMLElement);
    expect(row).toHaveTextContent("Draft");
    await user.click(within(row).getByRole("button", { name: "Start…" }));
    await user.click(within(row).getByRole("button", { name: "Start round" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Round started."));
    await waitFor(() => expect(row).toHaveTextContent("Open"));
    expect(fake.calls.find((c) => c.path.endsWith("/start"))!.body).toEqual({ startDelaySec: 3, durationSec: 300 });
    await user.click(within(row).getByRole("button", { name: "Close now" }));
    await waitFor(() => expect(row).toHaveTextContent("Closed"));
  });

  it("page count is limited to 1-50, and a card's color dots pick its category", async () => {
    const { fake, user } = setup(meAdmin);
    await user.click(await screen.findByRole("button", { name: "New round" }));
    await user.type(screen.getByLabelText("Name"), "R");
    const pages = screen.getByLabelText("Pages");
    await user.clear(pages);
    await user.type(pages, "9999");
    await user.tab(); // blur clamps the field back into range
    expect(pages).toHaveValue(50);
    expect(screen.getByRole("button", { name: "Create round" })).toBeEnabled();

    await user.clear(pages);
    await user.type(pages, "1");
    const card = screen.getByText("Item 1").closest(".item-card") as HTMLElement;
    expect(within(card).getByText("No category")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Gear" }));
    expect(within(card).getByText("Gear", { selector: ".cat-pill" })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Card" }));
    expect(within(card).getByRole("button", { name: "Card" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText("Card", { selector: ".cat-pill" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create round" }));
    const post = fake.calls.find((c) => c.method === "POST" && c.path.endsWith("/admin/auctions/rounds"))!;
    expect((post.body as { items: { name: string; category: string }[] }).items[0]).toMatchObject({ name: "Item 1", category: "CARD" });
  });

  it("an unticked item is saved as disabled in its slot", async () => {
    const { fake, user } = setup(meAdmin);
    await user.click(await screen.findByRole("button", { name: "New round" }));
    await user.type(screen.getByLabelText("Name"), "R");
    await user.click(screen.getByRole("checkbox", { name: "Use Item 2" }));
    expect(screen.getByRole("checkbox", { name: "Use Item 2" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Create round" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "POST" && c.path.endsWith("/admin/auctions/rounds"))).toBe(true));
    const post = fake.calls.find((c) => c.method === "POST" && c.path.endsWith("/admin/auctions/rounds"))!;
    expect((post.body as { items: { name: string; disabled: boolean }[] }).items.map((i) => [i.name, i.disabled])).toEqual([
      ["Item 1", false],
      ["Item 2", true],
      ["Item 3", false],
      ["Item 4", false],
    ]);
  });

  it("disabling every item blocks creating the round", async () => {
    const { user } = setup(meAdmin);
    await user.click(await screen.findByRole("button", { name: "New round" }));
    await user.type(screen.getByLabelText("Name"), "R");
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    expect(screen.getByText("Tick at least one item.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create round" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Enable all" }));
    expect(screen.getByRole("button", { name: "Create round" })).toBeEnabled();
  });

  it("pages can be cleared entirely and defaults back to 1 on blur", async () => {
    const { user } = setup(meAdmin);
    await user.click(await screen.findByRole("button", { name: "New round" }));
    const pages = screen.getByLabelText("Pages");
    await user.clear(pages);
    expect(pages).toHaveValue(null);
    await user.tab(); // blur
    expect(pages).toHaveValue(1);
  });

  it("a draft can be edited and saved (PATCH)", async () => {
    const { fake, user } = setup(meAdmin, { rounds: [draftRound] });
    const row = await screen.findByText(/Old draft/).then((e) => e.closest("li") as HTMLElement);
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "New name");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fake.calls.find((c) => c.method === "PATCH" && c.path.includes("auctions/rounds"))!.body).toMatchObject({ name: "New name" }));
  });

  it("starting the leftover draft while another round of that type is open explains ANOTHER_ROUND_OPEN", async () => {
    const closed = { ...draftRound, id: 1, name: "Queue round", type: "QUEUE_RANKED" as const, status: "CLOSED" as const, winCap: null, leftoverRoundId: 2 };
    const leftover = { ...draftRound, id: 2, name: "Queue round (leftovers)", type: "QUEUE_RANKED" as const, winCap: null };
    const open = { ...draftRound, id: 3, name: "Another queue round", type: "QUEUE_RANKED" as const, status: "OPEN" as const, winCap: null };
    const { user } = setup(meAdmin, { rounds: [closed, leftover, open] });
    const closedRow = await screen.findByText(/#1 Queue round$/).then((e) => e.closest("li") as HTMLElement);
    await user.click(within(closedRow).getByRole("button", { name: "Leftover draft" }));
    await screen.findByRole("form", { name: "Edit draft round" }); // the leftover draft is opened for review
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const draftRow = screen.getByText(/leftovers/).closest("li") as HTMLElement;
    await user.click(within(draftRow).getByRole("button", { name: "Start…" }));
    await user.click(within(draftRow).getByRole("button", { name: "Start round" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another ranked queue round (#3) is already open. Only one round of each type can be open at a time: close it first, then start this one.");
  });

  it("shows every member's preference list of a queue round", async () => {
    const queue = { ...draftRound, id: 1, name: "Q", type: "QUEUE_RANKED" as const, status: "OPEN" as const, winCap: null, items: [{ id: 1, name: "Gear 1", category: "GEAR", rarity: null, imageUrl: null }, { id: 2, name: "Gear 2", category: "GEAR", rarity: null, imageUrl: null }] };
    const { user } = setup(meAdmin, { rounds: [queue] });
    await user.click(await screen.findByRole("button", { name: "Preference lists" }));
    expect(await screen.findByTestId("prefs-view")).toHaveTextContent("Bo: 1. Gear 2 2. Gear 1");
  });
});
