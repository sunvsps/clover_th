import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./server";

// Any request a test did not explicitly mock is an error, so accidental network calls cannot pass silently.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.location.hash = "";
});
afterAll(() => server.close());

// Testing Library detects fake timers through a `jest` global and advances them itself; Vitest has none, so without
// this shim every awaited user event hangs once a test calls vi.useFakeTimers().
(globalThis as unknown as { jest: { advanceTimersByTime: (ms: number) => void } }).jest = {
  advanceTimersByTime: (ms) => vi.advanceTimersByTime(ms),
};
