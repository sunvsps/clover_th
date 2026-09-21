import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverClock } from "./serverClock";
import { usePolling } from "./usePolling";

afterEach(() => {
  vi.useRealTimers();
  serverClock.reset();
});

describe("usePolling", () => {
  it("fetches at once, then on every interval, and stops on unmount", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const { result, unmount } = renderHook(() => usePolling(fetcher, { intervalMs: 1000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.data).toBe(3);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps polling after an error and reports it", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue("ok");
    const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 1000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.data).toBe("ok");
  });

  it("does not poll while disabled, and serverNow follows the learned server offset", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      serverClock.observe(new Date(Date.now() + 5000).toISOString(), Date.now(), Date.now());
      return 1;
    });
    const off = renderHook(() => usePolling(fetcher, { intervalMs: 1000, enabled: false }));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetcher).not.toHaveBeenCalled();
    off.unmount();
    const { result } = renderHook(() => usePolling(fetcher, { intervalMs: 1000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.serverNow() - Date.now()).toBe(5000);
  });
});
