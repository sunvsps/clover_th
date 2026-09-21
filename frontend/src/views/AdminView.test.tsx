import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveAuction from "../test/LiveAuction";

afterEach(() => vi.useRealTimers());

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "test-sign-in" }));
}

describe("AdminView", () => {
  it("is only shown to admins", async () => {
    const user = userEvent.setup();
    render(<LiveAuction />);
    expect(screen.queryByText("ADMIN CONTROLS")).not.toBeInTheDocument();
    await signIn(user);
    expect(screen.getByText("ADMIN CONTROLS")).toBeInTheDocument();
    expect(screen.getByText("Manage auction round")).toBeInTheDocument();
    expect(screen.getByText(/Round open except locked pages: none/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "test-switch-user" }));
    expect(screen.queryByText("ADMIN CONTROLS")).not.toBeInTheDocument();
  });

  it("the page picker locks pages, reports them, and the locked page is marked", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<LiveAuction notify={notify} />);
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /Select pages \(0\)/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Select pages to lock");
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    await user.click(screen.getByRole("button", { name: "Page 7" }));
    expect(dialog).toHaveTextContent("2 pages selected");
    await user.click(screen.getByRole("button", { name: "Apply locks" }));
    expect(notify).toHaveBeenCalledWith("Locked pages: 3, 7");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Page 3")).toHaveClass("page-locked");
    expect(screen.getByLabelText("Page 4")).not.toHaveClass("page-locked");
    expect(screen.getByRole("button", { name: /Select pages \(2\)/ })).toBeInTheDocument();
  });

  it("the picker can move to pages 26-50 and cancel with the backdrop", async () => {
    const user = userEvent.setup();
    render(<LiveAuction />);
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /Select pages/ }));
    expect(screen.getByText("Pages 1 - 25")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button").find((b) => b.closest(".page-modal-range") && !(b as HTMLButtonElement).disabled)!);
    expect(screen.getByText("Pages 26 - 50")).toBeInTheDocument();
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Start round runs the 3-2-1 countdown, opens the round with the chosen minutes, and the round ends when time is up", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null });
    render(<LiveAuction />);
    await signIn(user);
    const minutes = screen.getByLabelText("ROUND MINUTES");
    await user.clear(minutes);
    await user.type(minutes, "1");
    await user.click(screen.getByRole("button", { name: "Start round" }));
    expect(screen.getByText("Auction starting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("3");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.queryByText("Auction starting")).not.toBeInTheDocument();
    expect(screen.getByText("Auction is open")).toBeInTheDocument();
    expect(screen.getByText("ROUND 01")).toBeInTheDocument();
    expect(screen.getAllByText("01:00").length).toBeGreaterThan(0);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Round 01 has ended");
    expect(screen.getByText("Round time is over")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
