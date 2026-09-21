import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Me } from "./api";
import { meAdmin, mockApi } from "./test/api";

async function renderApp(me: Me | null = meAdmin) {
  mockApi({ me });
  render(<App />);
  if (me) await screen.findByRole("navigation", { name: "Guild tools" });
}

describe("App shell", () => {
  it("renders the top bar, the three feature tabs and the auction page", async () => {
    await renderApp();
    expect(screen.getByLabelText("Clover TH home")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Guild tools" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Auction", "Schedule", "Team planner"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guild item auction");
    expect(await screen.findByText(/no auction round yet/i)).toBeInTheDocument();
  });

  it("the tabs switch views and keep the URL hash in step; the auction page stays mounted but hidden", async () => {
    const user = userEvent.setup({ delay: null });
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
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByRole("button", { name: /ประมูลไอเท็ม/ })).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveClass("thai-theme");
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByRole("button", { name: "Auction" })).toBeInTheDocument();
  });

  it("shows the profile from /me in the shell", async () => {
    await renderApp();
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ADMIN/ })).toBeInTheDocument();
  });

  it("signing out returns to the sign-in screen", async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await user.click(screen.getByTitle("Sign out"));
    expect(await screen.findByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Guild item auction" })).not.toBeInTheDocument();
  });
});
