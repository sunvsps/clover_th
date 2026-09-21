import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { ApiError, get, knownErrorCodes, loadGuildData, messageForCode, onUnauthorized, post, registrationFromWire, registrationToWire, serverClock } from ".";
import { mockApi, wireMembers } from "../test/api";

afterEach(() => {
  serverClock.reset();
  onUnauthorized(null);
});

describe("API client", () => {
  it("sends cookies, and X-Requested-With only on writes", async () => {
    const seen: { method: string; credentials: string; xrw: string | null }[] = [];
    server.use(
      http.all("*/api/v1/ping", ({ request }) => {
        seen.push({ method: request.method, credentials: request.credentials, xrw: request.headers.get("x-requested-with") });
        return HttpResponse.json({ ok: true });
      }),
    );
    await get("/api/v1/ping");
    await post("/api/v1/ping", { a: 1 });
    expect(seen[0]).toMatchObject({ method: "GET", credentials: "include", xrw: null });
    expect(seen[1]).toMatchObject({ method: "POST", credentials: "include", xrw: "clover-web" });
  });

  it("parses the error envelope into a typed ApiError", async () => {
    server.use(
      http.get("*/api/v1/x", () =>
        HttpResponse.json({ error: { code: "DUPLICATE_IGN", message: "taken", details: { ign: "Bo" } } }, { status: 409 }),
      ),
    );
    const err = await get("/api/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "DUPLICATE_IGN", details: { ign: "Bo" } });
    expect((err as ApiError).userMessage(true)).toBe(messageForCode("DUPLICATE_IGN", true));
  });

  it("turns a non-envelope failure and a network failure into coded errors", async () => {
    server.use(http.get("*/api/v1/plain", () => new HttpResponse("boom", { status: 502 })), http.get("*/api/v1/down", () => HttpResponse.error()));
    expect(await get("/api/v1/plain").catch((e: unknown) => e)).toMatchObject({ status: 502, code: "HTTP_502" });
    expect(await get("/api/v1/down").catch((e: unknown) => e)).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("calls the unauthorized handler on 401 AUTH_REQUIRED only", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    server.use(
      http.get("*/api/v1/a", () => HttpResponse.json({ error: { code: "AUTH_REQUIRED", message: "", details: {} } }, { status: 401 })),
      http.get("*/api/v1/b", () => HttpResponse.json({ error: { code: "ADMIN_REQUIRED", message: "", details: {} } }, { status: 403 })),
    );
    await get("/api/v1/a").catch(() => {});
    await get("/api/v1/b").catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("learns the server clock offset from the body serverTime and the X-Server-Time header", async () => {
    const ahead = new Date(Date.now() + 60_000).toISOString();
    server.use(http.get("*/api/v1/t", () => HttpResponse.json({ serverTime: ahead })));
    await get("/api/v1/t");
    expect(Math.abs(serverClock.offset() - 60_000)).toBeLessThan(2_000);
    serverClock.reset();
    const behind = new Date(Date.now() - 30_000).toISOString();
    server.use(http.get("*/api/v1/h", () => HttpResponse.json({}, { headers: { "X-Server-Time": behind } })));
    await get("/api/v1/h");
    expect(Math.abs(serverClock.offset() + 30_000)).toBeLessThan(2_000);
    expect(Math.abs(serverClock.now() - (Date.now() - 30_000))).toBeLessThan(2_000);
  });
});

describe("error-code messages", () => {
  it("has English and Thai text for every known code, and a generic fallback for unknown ones", () => {
    for (const code of knownErrorCodes) {
      expect(messageForCode(code, false)).toBeTruthy();
      expect(messageForCode(code, true)).toMatch(/[฀-๿]/);
    }
    expect(messageForCode("SOMETHING_NEW", false, "server text")).toBe("server text");
    expect(messageForCode("SOMETHING_NEW", true, "server text")).toMatch(/[฀-๿]/);
  });
});

describe("wire enums", () => {
  it("maps registration status only inside src/api", () => {
    expect(registrationFromWire("JOINED")).toBe("joined");
    expect(registrationFromWire("LEAVE")).toBe("leave");
    expect(registrationToWire("joined")).toBe("JOINED");
    expect(registrationToWire("leave")).toBe("LEAVE");
  });
});

describe("loadGuildData", () => {
  it("adapts /members, /jobs, /events and /activities into UI types (members keyed by id, shown by ign)", async () => {
    mockApi();
    const data = await loadGuildData();
    expect(data.members).toEqual(wireMembers.map((m) => ({ id: m.id, ign: m.ign, job: m.jobId })));
    expect(data.jobs[0]).toEqual({ id: 1, label: "High Priest", color: expect.any(String) });
    expect(data.events[0]).toMatchObject({ id: "e-1", day: 2, start: "20:00", end: "21:00", guild: true });
    expect(data.activities).toHaveLength(2);
  });
});
