import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSession } from "../hooks/useSession";
import TopBar from "./TopBar";

function setup(isThai = false) {
  const notify = vi.fn();
  const onSwitchToUser = vi.fn();
  const onToggleLanguage = vi.fn();
  const hook = renderHook(() => useSession({ notify }));
  const ui = () => (
    <TopBar session={hook.result.current} isThai={isThai} onToggleLanguage={onToggleLanguage} onSwitchToUser={onSwitchToUser} />
  );
  const view = render(ui());
  const rerender = () => view.rerender(ui());
  return { hook, notify, onSwitchToUser, onToggleLanguage, rerender };
}

describe("TopBar (auth/session shell)", () => {
  it("shows the brand and a Discord sign-in button while signed out", () => {
    setup();
    expect(screen.getByLabelText("Clover TH home")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with Discord/ })).toBeInTheDocument();
    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
  });

  it("signing in shows the user name with the ADMIN badge; signing out returns to the sign-in button", async () => {
    const user = userEvent.setup();
    const t = setup();
    await user.click(screen.getByRole("button", { name: /Sign in with Discord/ }));
    t.rerender();
    expect(screen.getByText("Mew")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ADMIN/ })).toBeInTheDocument();
    await user.click(screen.getByTitle("Sign out"));
    t.rerender();
    expect(screen.getByRole("button", { name: /Sign in with Discord/ })).toBeInTheDocument();
  });

  it("the role menu switches an admin to the USER view and reports it", async () => {
    const user = userEvent.setup();
    const t = setup();
    await user.click(screen.getByRole("button", { name: /Sign in with Discord/ }));
    t.rerender();
    await user.click(screen.getByRole("button", { name: /ADMIN/ }));
    expect(screen.getByText("Current role")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to USER view" }));
    expect(t.onSwitchToUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Current role")).not.toBeInTheDocument(); // the menu closed
    act(() => t.hook.result.current.switchToUser());
    t.rerender();
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(t.notify).toHaveBeenCalledWith("Switched to User view.");
  });

  it("the language button shows the other language and calls back", async () => {
    const user = userEvent.setup();
    const t = setup(true);
    await user.click(screen.getByTitle("Switch language"));
    expect(screen.getByTitle("Switch language")).toHaveTextContent("EN");
    expect(t.onToggleLanguage).toHaveBeenCalledTimes(1);
  });
});
