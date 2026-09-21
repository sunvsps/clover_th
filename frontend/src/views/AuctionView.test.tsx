import { renderHook, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { guildMembers } from "../data/guild";
import { useAdminControls } from "../hooks/useAdminControls";
import { useAuction } from "../hooks/useAuction";
import AuctionView from "./AuctionView";

function harness(opts: { isAuthenticated?: boolean; isAdmin?: boolean; visible?: boolean; isThai?: boolean } = {}) {
  const notify = vi.fn();
  const state = renderHook(() => {
    const auction = useAuction({ isAuthenticated: opts.isAuthenticated ?? false, ign: "Mew", notify });
    const admin = useAdminControls({ lockedPages: auction.lockedPages, setLockedPages: auction.setLockedPages, notify });
    return { auction, admin };
  });
  render(
    <AuctionView
      visible={opts.visible ?? true}
      isThai={opts.isThai ?? false}
      isAuthenticated={opts.isAuthenticated ?? false}
      isAdmin={opts.isAdmin ?? false}
      ign="Mew"
      members={guildMembers}
      auction={state.result.current.auction}
      admin={state.result.current.admin}
      notify={notify}
    />,
  );
  return { notify };
}

describe("AuctionView", () => {
  it("renders the board: heading, waiting status, 25 page blocks of 4 items, and disabled reserve buttons when signed out", () => {
    harness();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guild item queue");
    expect(screen.getByText("Waiting for admin to start")).toBeInTheDocument();
    expect(screen.getByText("Reservations are paused")).toBeInTheDocument();
    const blocks = screen.getByLabelText("Auction item pages").querySelectorAll(".page-block");
    expect(blocks).toHaveLength(25);
    expect(within(blocks[0] as HTMLElement).getAllByRole("button")).toHaveLength(4);
    for (const button of screen.getAllByRole("button", { name: /Reserve/ })) expect(button).toBeDisabled();
    expect(screen.getByText("ROUND --")).toBeInTheDocument();
    expect(screen.getByText("--:--")).toBeInTheDocument();
  });

  it("has no admin controls for a normal user", () => {
    harness({ isAuthenticated: true });
    expect(screen.queryByText("ADMIN CONTROLS")).not.toBeInTheDocument();
  });

  it("the page group button moves between pages 1-25 and 26-50", async () => {
    // a static snapshot of the hook cannot re-render, so drive the real hook through the composed harness component
    const user = userEvent.setup();
    const { default: Live } = await import("../test/LiveAuction");
    render(<Live />);
    expect(screen.getAllByText("1 - 25").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /Next/ })[0]!);
    expect(screen.getAllByText("26 - 50").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Page 26")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Previous/ })[0]!);
    expect(screen.getByLabelText("Page 1")).toBeInTheDocument();
  });

  it("stays mounted but hidden when another view is active", () => {
    harness({ visible: false });
    expect(document.getElementById("top")).toHaveClass("hidden-view");
  });

  it("shows Thai copy in the Thai language", () => {
    harness({ isThai: true });
    expect(screen.getByText("รอแอดมินเริ่มประมูล")).toBeInTheDocument();
    expect(screen.getByText("รายการไอเท็ม")).toBeInTheDocument();
  });
});
