import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHashView, viewFromHash } from "./useHashView";

describe("useHashView", () => {
  it("starts on the auction view and knows only calendar and teams", () => {
    window.location.hash = "";
    expect(viewFromHash()).toBe("auction");
    window.location.hash = "#teams";
    expect(viewFromHash()).toBe("teams");
    window.location.hash = "#nonsense";
    expect(viewFromHash()).toBe("auction");
  });

  it("updates the hash when the view changes and follows hashchange events", () => {
    window.location.hash = "";
    const { result } = renderHook(() => useHashView());
    expect(result.current.activeView).toBe("auction");
    act(() => result.current.setActiveView("calendar"));
    expect(window.location.hash).toBe("#calendar");
    act(() => {
      window.location.hash = "#teams";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeView).toBe("teams");
    act(() => result.current.setActiveView("auction"));
    expect(window.location.hash).toBe("");
  });
});
