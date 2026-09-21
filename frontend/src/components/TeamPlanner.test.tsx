import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";

const chartCard = () => document.querySelector(".chart-card") as HTMLElement;

async function openPlanner(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Sign in with Discord/ }));
  await user.click(screen.getByRole("button", { name: /Team planner/ }));
}

describe("TeamPlanner: chart card and job manager", () => {
  it("shows the members-per-job chart with every job, and the edit link for admins", async () => {
    const user = userEvent.setup();
    await openPlanner(user);
    const card = chartCard();
    for (const label of ["High Priest", "Knight", "Wizard", "Sniper", "Gunslinger", "Assassin", "Paladin"]) {
      expect(within(card).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(card).getByRole("button", { name: /Edit jobs/ })).toBeInTheDocument();
    expect(within(card).getByText(/members$/)).toBeInTheDocument();
  });

  it("a non-admin sees the chart but neither the edit link nor the manager", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Team planner/ }));
    expect(chartCard()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit jobs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manage jobs/ })).not.toBeInTheDocument();
  });

  it("renames a job in the manager, adds a new one, saves, and the chart shows both", async () => {
    const user = userEvent.setup();
    await openPlanner(user);
    await user.click(screen.getByRole("button", { name: /Manage jobs/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Jobs & card colours");
    const names = within(dialog).getAllByLabelText("Job name");
    expect(names.length).toBeGreaterThanOrEqual(8);
    await user.clear(names[0]!);
    await user.type(names[0]!, "Priest");
    await user.type(within(dialog).getByPlaceholderText("New job name"), "Bard");
    await user.click(within(dialog).getByRole("button", { name: /Add to list/ }));
    expect(within(dialog).getAllByLabelText("Job name").some((input) => (input as HTMLInputElement).value === "Bard")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Job list saved.")).toBeInTheDocument();
    const card = chartCard();
    expect(within(card).getAllByText("Priest").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("Bard").length).toBeGreaterThan(0);
    expect(within(card).queryByText("High Priest")).not.toBeInTheDocument();
  });

  it("refuses empty or duplicate job names (Save disabled with the reason), and Cancel discards the draft", async () => {
    const user = userEvent.setup();
    await openPlanner(user);
    await user.click(screen.getByRole("button", { name: /Edit jobs/ }));
    const dialog = screen.getByRole("dialog");
    const names = within(dialog).getAllByLabelText("Job name");
    await user.clear(names[1]!);
    await user.type(names[1]!, (names[0] as HTMLInputElement).value.toUpperCase()); // duplicate, case-insensitive
    expect(within(dialog).getByText("Job names must be filled in and unique.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Save/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Edit jobs/ }));
    expect(within(screen.getByRole("dialog")).getAllByLabelText("Job name").every((i) => (i as HTMLInputElement).value.trim())).toBe(true);
    expect(screen.queryByText("Job list saved.")).not.toBeInTheDocument();
  });

  it("a job that members still use cannot be deleted; an unused new job can", async () => {
    const user = userEvent.setup();
    await openPlanner(user);
    await user.click(screen.getByRole("button", { name: /Manage jobs/ }));
    const dialog = screen.getByRole("dialog");
    const deleteButtons = within(dialog).getAllByRole("button", { name: "Delete job" });
    expect(deleteButtons[0]).toBeDisabled(); // High Priest has members on the roster
    await user.type(within(dialog).getByPlaceholderText("New job name"), "Temp");
    await user.click(within(dialog).getByRole("button", { name: /Add to list/ }));
    const all = within(dialog).getAllByRole("button", { name: "Delete job" });
    const last = all[all.length - 1]!;
    expect(last).toBeEnabled();
    await user.click(last);
    expect(within(dialog).queryByDisplayValue("Temp")).not.toBeInTheDocument();
  });
});
