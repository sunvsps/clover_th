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
    retry: vi.fn(),
    dismissAuthError: vi.fn(),
    ...over,
  } as Session;
}

const signedIn = (over: Partial<Session> = {}) =>
  fakeSession({ isAuthenticated: true, memberId: "m-aria", userName: "Aria", ign: "Aria", ...over });

function setup(session: Session, isThai = false) {
  const onToggleLanguage = vi.fn();
  render(<TopBar session={session} isThai={isThai} onToggleLanguage={onToggleLanguage} />);
  return { onToggleLanguage };
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
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTitle("Sign out"));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it("a non-admin gets the USER badge and no role menu", () => {
    setup(signedIn());
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ADMIN/ })).not.toBeInTheDocument();
  });

  it("an admin sees a plain ADMIN badge: no menu that pretends to change permissions", () => {
    setup(signedIn({ isAdmin: true }));
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ADMIN/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Switch to USER/)).not.toBeInTheDocument();
  });

  it("the language button shows the other language and calls back", async () => {
    const user = userEvent.setup();
    const t = setup(fakeSession(), true);
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByTitle("Switch language")).toHaveTextContent("EN");
    expect(t.onToggleLanguage).toHaveBeenCalledTimes(1);
  });
});
