import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./server";

describe("MSW test server", () => {
  it("answers requests a test mocks", async () => {
    server.use(http.get("http://api.test/api/v1/me", () => HttpResponse.json({ ign: "Mew" })));
    const res = await fetch("http://api.test/api/v1/me");
    expect(await res.json()).toEqual({ ign: "Mew" });
  });

  it("fails loudly on a request nobody mocked", async () => {
    await expect(fetch("http://api.test/api/v1/unmocked")).rejects.toThrow();
  });
});
