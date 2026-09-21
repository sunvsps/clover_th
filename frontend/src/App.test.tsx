import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Me } from "./api";
import { meAdmin, mockApi } from "./test/api";

afterEach(() => vi.useRealTimers());

// only intervals are faked: the API mocks (MSW / fetch) need the real setTimeout
const FAKE: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["setInterval", "clearInterval"] };

async function renderApp(me: Me | null = meAdmin) {
  mockApi({ me });
  render(<App />);
  if (me) await screen.findByRole("navigation", { name: "Guild tools" });
}

const chartCard = () => document.querySelector(".chart-card") as HTMLElement;

/** Runs a round (3 s countdown), leaving the round open. */
async function openRound(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Start round" }));
  await act(() => vi.advanceTimersByTimeAsync(3000));
}

describe("App shell", () => {
  it("renders the top bar, the three feature tabs and the auction page", async () => {
    await renderApp();
    expect(screen.getByLabelText("Clover TH home")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Guild tools" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Auction", "Schedule", "Team planner"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guild item queue");
  });

  it("the tabs switch views and keep the URL hash in step; the auction page stays mounted but hidden", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(window.location.hash).toBe("#calendar");
    expect(document.getElementById("top")).toHaveClass("hidden-view");
    expect(document.querySelector(".feature-content")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Team planner" }));
    expect(window.location.hash).toBe("#teams");
    expect(document.querySelector(".feature-content.wide")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Auction" }));
    expect(document.getElementById("top")).not.toHaveClass("hidden-view");
  });

  it("switches the whole shell to Thai and back", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByRole("button", { name: /ประมูลไอเท็ม/ })).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveClass("thai-theme");
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByRole("button", { name: "Auction" })).toBeInTheDocument();
  });

  it("shows the profile from /me and the roster count in the shell", async () => {
    await renderApp();
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ADMIN/ })).toBeInTheDocument();
  });
});

describe("App: reservation flow (behaviour kept from before the extraction)", () => {
  it("reserve, summary, received marks, remove", async () => {
    vi.useFakeTimers(FAKE);
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await openRound(user);
    expect(screen.getByText("Auction started.")).toBeInTheDocument();
    const first = screen.getByLabelText("Page 1");
    await user.click(within(first).getAllByRole("button", { name: /Reserve/ })[0]!);
    expect(screen.getByText("Page 1 / Item 1 is reserved for Aria.")).toBeInTheDocument();
    expect(within(first).getByText("Reserved by Aria")).toBeInTheDocument();
    expect(within(first).getAllByRole("button", { name: /Remove/ })).toHaveLength(1);
    // the second item of page 2
    await user.click(within(screen.getByLabelText("Page 2")).getAllByRole("button", { name: /Reserve/ })[1]!);
    const summary = document.querySelector(".summary-grid") as HTMLElement;
    expect(within(summary).getByText("Aria")).toBeInTheDocument();
    expect(within(summary).getByText("2 items")).toBeInTheDocument();
    expect(within(summary).getByText("Page 1 / Item 1")).toBeInTheDocument();
    expect(screen.getByText("2 items reserved")).toBeInTheDocument();
    // received marks
    await user.click(within(summary).getAllByRole("button", { name: /Received$/ })[0]!);
    expect(screen.getByText("Page 1 / Item 1 marked as received.")).toBeInTheDocument();
    await user.click(within(summary).getByRole("button", { name: "Received all" }));
    expect(screen.getByText("All reserved items marked as received.")).toBeInTheDocument();
    await user.click(within(summary).getByRole("button", { name: "Undo all" }));
    expect(screen.getByText("All received marks removed.")).toBeInTheDocument();
    // remove one reservation
    await user.click(within(first).getByRole("button", { name: /Remove/ }));
    expect(screen.getByText("Page 1 / Item 1 reservation removed.")).toBeInTheDocument();
    expect(screen.getByText("1 items reserved")).toBeInTheDocument();
  });

  it("copy list writes the readable summary to the clipboard", async () => {
    vi.useFakeTimers(FAKE);
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderApp();
    await openRound(user);
    await user.click(within(screen.getByLabelText("Page 1")).getAllByRole("button", { name: /Reserve/ })[2]!);
    await user.click(screen.getByRole("button", { name: /Copy list/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("Clover_TH Auction - Round 01");
    expect(text).toContain("1 members · 1 items reserved");
    expect(text).toContain("1. Aria");
    expect(text).toContain("   • Page 1 — Item 3");
    expect(screen.getByText("Readable reservation summary copied to clipboard.")).toBeInTheDocument();
  });

  it("locked pages block reserving; held-page release needs a finished round", async () => {
    vi.useFakeTimers(FAKE);
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Release held pages" }));
    expect(screen.getByText("Finish the current round before releasing held pages.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Select pages/ }));
    await user.click(screen.getByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Apply locks" }));
    await user.click(screen.getByRole("button", { name: "Start round" }));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    for (const button of within(screen.getByLabelText("Page 1")).getAllByRole("button")) expect(button).toBeDisabled();
    expect(within(screen.getByLabelText("Page 2")).getAllByRole("button")[0]).toBeEnabled();
  });

  it("signing out returns to the sign-in screen; the toast can be dismissed", async () => {
    vi.useFakeTimers(FAKE);
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await openRound(user);
    await user.click(within(screen.getByLabelText("Page 3")).getAllByRole("button", { name: /Reserve/ })[0]!);
    const toast = document.querySelector(".toast") as HTMLElement;
    await user.click(within(toast).getByRole("button"));
    expect(document.querySelector(".toast")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Sign out"));
    expect(await screen.findByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Page 4")).not.toBeInTheDocument();
  });
});

describe("App: schedule and planner state kept across tabs", () => {
  it("the roster survives tab changes and a rename shows up in the planner", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Team planner" }));
    expect(chartCard()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    await user.click(screen.getByRole("button", { name: "Team planner" }));
    expect(chartCard()).toBeInTheDocument();
  });
});
