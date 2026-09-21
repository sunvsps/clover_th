import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../hooks/useSession";
import TopBar from "./TopBar";

function fakeSession(over: Partial<Session> = {}): Session {
  return {
    state: { status: "signedOut" },
    isAuthenticated: false,
    memberId: "",
    userName: "",
    ign: "",
    isAdmin: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    switchToUser: vi.fn(),
    retry: vi.fn(),
    dismissAuthError: vi.fn(),
    ...over,
  } as Session;
}

const signedIn = (over: Partial<Session> = {}) =>
  fakeSession({ isAuthenticated: true, memberId: "m-aria", userName: "Aria", ign: "Aria", ...over });

function setup(session: Session, isThai = false) {
  const onSwitchToUser = vi.fn();
  const onToggleLanguage = vi.fn();
  render(<TopBar session={session} isThai={isThai} onToggleLanguage={onToggleLanguage} onSwitchToUser={onSwitchToUser} />);
  return { onSwitchToUser, onToggleLanguage };
}

describe("TopBar (auth/session shell)", () => {
  it("shows the brand and a Discord sign-in button while signed out; the button starts the Discord login", async () => {
    const session = fakeSession();
    setup(session);
    expect(screen.getByLabelText("Clover TH home")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Sign in with Discord/ }));
    expect(session.signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the member from /me with the ADMIN badge; the sign-out button signs out", async () => {
    const session = signedIn({ isAdmin: true });
    setup(session);
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ADMIN/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTitle("Sign out"));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it("a non-admin gets the USER badge and no role menu", () => {
    setup(signedIn());
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ADMIN/ })).not.toBeInTheDocument();
  });

  it("the role menu asks to switch an admin to the USER view and closes", async () => {
    const user = userEvent.setup();
    const t = setup(signedIn({ isAdmin: true }));
    await user.click(screen.getByRole("button", { name: /ADMIN/ }));
    expect(screen.getByText("Current role")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to USER view" }));
    expect(t.onSwitchToUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Current role")).not.toBeInTheDocument();
  });

  it("the language button shows the other language and calls back", async () => {
    const user = userEvent.setup();
    const t = setup(fakeSession(), true);
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByTitle("Switch language")).toHaveTextContent("EN");
    expect(t.onToggleLanguage).toHaveBeenCalledTimes(1);
  });
});
