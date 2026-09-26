import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Me } from "./api";
import { meAdmin, mockApi } from "./test/api";
import { server } from "./test/server";

async function renderApp(me: Me | null = meAdmin) {
  mockApi({ me });
  render(<App />);
  if (me) await screen.findByRole("navigation", { name: "Guild tools" });
}

describe("App shell", () => {
  it("renders the top bar, the feature tabs and the auction page", async () => {
    await renderApp();
    expect(screen.getByLabelText("Clover TH home")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Guild tools" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Auction", "Auction queue", "Schedule", "Team planner", "Complaint", "Admin config"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guild item queue");
    expect(await screen.findByText(/no auction round yet/i)).toBeInTheDocument();
  });

  it("the tabs switch views and keep the URL hash in step", async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Auction queue" }));
    expect(window.location.hash).toBe("#queue");
    expect(await screen.findByTestId("queue-page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(window.location.hash).toBe("#calendar");
    expect(document.getElementById("top")).not.toBeInTheDocument();
    expect(document.querySelector(".feature-content")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Team planner" }));
    expect(window.location.hash).toBe("#teams");
    expect(document.querySelector(".feature-content.wide")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Auction" }));
    expect(window.location.hash).toBe("");
    expect(document.getElementById("top")).toBeInTheDocument();
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
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });

  it("signing out returns to the sign-in screen", async () => {
    const user = userEvent.setup({ delay: null });
    await renderApp();
    await user.click(screen.getByTitle("Sign out"));
    expect(await screen.findByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Guild item auction" })).not.toBeInTheDocument();
  });
});

describe("remembered language", () => {
  it("starts in the language saved on the member", async () => {
    await renderApp({ ...meAdmin, language: "th" });
    expect(within(screen.getByRole("navigation", { name: "Guild tools" })).getByRole("button", { name: "ประมูลไอเท็ม" })).toBeInTheDocument();
  });

  it("switching saves the pick on the member (PUT /me/language) and in this browser", async () => {
    const saved: unknown[] = [];
    await renderApp();
    server.use(http.put("*/api/v1/me/language", async ({ request }) => {
      const body = await request.json();
      saved.push(body);
      return HttpResponse.json(body);
    }));
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "TH" }));
    expect(screen.getByRole("button", { name: "ประมูลไอเท็ม" })).toBeInTheDocument();
    await waitFor(() => expect(saved).toEqual([{ language: "th" }]));
    expect(localStorage.getItem("clover.language")).toBe("th");
  });

  it("before sign-in, the browser's last pick is used", async () => {
    localStorage.setItem("clover.language", "th");
    await renderApp(null);
    expect(await screen.findByRole("button", { name: "EN" })).toBeInTheDocument();
  });
});
