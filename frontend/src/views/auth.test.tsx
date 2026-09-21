import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { get, LOGIN_URL } from "../api";
import { navigate } from "../lib/navigate";
import { fakePlanner, meAdmin, meUser, mockApi, wireMembers } from "../test/api";
import { server } from "../test/server";

vi.mock("../lib/navigate", () => ({ navigate: vi.fn() }));

beforeEach(() => vi.mocked(navigate).mockClear());
afterEach(() => window.history.replaceState(null, "", "/"));

describe("sign-in and /me", () => {
  it("a registered Discord user sees the profile returned by /me", async () => {
    mockApi({ me: meUser });
    render(<App />);
    expect(await screen.findByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
  });

  it("an admin from /me gets the admin badge", async () => {
    mockApi({ me: meAdmin });
    render(<App />);
    expect(await screen.findByText("ADMIN")).toBeInTheDocument();
  });

  it("without a session the sign-in screen appears and the button goes to the Discord login", async () => {
    mockApi({ me: null });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
    await userEvent.setup({ delay: null }).click(screen.getAllByRole("button", { name: /Sign in with Discord/ })[1]!);
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(LOGIN_URL).toBe("/api/v1/auth/discord/login");
  });

  it.each([
    ["AUTH_NOT_REGISTERED", "Not registered", /not registered with the guild/],
    ["AUTH_MEMBER_INACTIVE", "Membership deactivated", /deactivated/],
    ["AUTH_STATE_INVALID", "Sign-in link expired", /expired or was already used/],
    ["AUTH_OAUTH_FAILED", "Sign-in did not complete", /did not complete/],
  ])("?authError=%s shows its own screen and clears the address", async (code, title, text) => {
    mockApi({ me: null });
    window.history.replaceState(null, "", `/?authError=${code}`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("alert")).toHaveAttribute("data-auth-screen", code);
    expect(window.location.search).toBe("");
  });

  it("the not-registered screen has no sign-in retry; Back returns to the sign-in screen", async () => {
    mockApi({ me: null });
    window.history.replaceState(null, "", "/?authError=AUTH_NOT_REGISTERED");
    render(<App />);
    await screen.findByRole("heading", { name: "Not registered" });
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
  });

  it("the not-registered screen renders in Thai", async () => {
    mockApi({ me: null });
    window.history.replaceState(null, "", "/?authError=AUTH_NOT_REGISTERED");
    render(<App />);
    await screen.findByRole("heading", { name: "Not registered" });
    await userEvent.setup({ delay: null }).click(screen.getByTitle("Switch language"));
    expect(screen.getByRole("heading", { name: "ยังไม่ได้ลงทะเบียน" })).toBeInTheDocument();
  });

  it("an unknown authError value falls back to the generic sign-in-failed screen", async () => {
    mockApi({ me: null });
    window.history.replaceState(null, "", "/?authError=WHATEVER");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign-in did not complete" })).toBeInTheDocument();
  });

  it("a 401 after loading leads to the session-expired screen", async () => {
    mockApi({ me: meAdmin });
    render(<App />);
    await screen.findByRole("navigation", { name: "Guild tools" });
    server.use(http.get("*/api/v1/later", () => HttpResponse.json({ error: { code: "AUTH_REQUIRED", message: "", details: {} } }, { status: 401 })));
    await act(async () => {
      await get("/api/v1/later").catch(() => {});
    });
    expect(await screen.findByRole("heading", { name: "Session expired" })).toBeInTheDocument();
  });

  it("sign-out calls POST /auth/logout with the CSRF header and returns to the sign-in screen", async () => {
    mockApi({ me: meAdmin });
    let header: string | null = null;
    server.use(
      http.post("*/api/v1/auth/logout", ({ request }) => {
        header = request.headers.get("x-requested-with");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<App />);
    await userEvent.setup({ delay: null }).click(await screen.findByTitle("Sign out"));
    expect(await screen.findByRole("heading", { name: "Clover guild tools" })).toBeInTheDocument();
    expect(header).toBe("clover-web");
  });

  it("an API outage on /me shows a retryable error, not the sign-in screen", async () => {
    server.use(http.get("*/api/v1/me", () => HttpResponse.error()));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Cannot load your account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("data from the API", () => {
  it("the team planner roster comes from /members (not from a built-in list)", async () => {
    mockApi({ me: meAdmin });
    fakePlanner({ me: meAdmin, layout: [{ name: "Main", teams: 2 }] });
    render(<App />);
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: "Team planner" }));
    await screen.findByText("Other members"); // the plan has loaded; unplaced members are listed for the admin
    for (const member of wireMembers) expect(screen.getAllByText(member.ign).length).toBeGreaterThan(0);
  });

  it("the schedule shows the events from /events", async () => {
    mockApi({ me: meAdmin });
    render(<App />);
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: "Schedule" }));
    expect((await screen.findAllByText(/Guild War/)).length).toBeGreaterThan(0);
  });

  it("failing to load the guild data shows a retry", async () => {
    mockApi({ me: meAdmin });
    server.use(http.get("*/api/v1/jobs", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "x", details: {} } }, { status: 500 })));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("no built-in demo identity", () => {
  it("no source file hardcodes the old demo user name", () => {
    const needle = ["M", "ew"].join("");
    const files = import.meta.glob("/src/**/*.{ts,tsx,css,html}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(20); // the glob really found the sources
    const hits = Object.entries(files)
      .filter(([, text]) => text.includes(needle))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
