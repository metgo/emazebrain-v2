import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("api", () => {
  const app = createApp({ cell: "il", version: "test" });

  it("reports health with the cell name", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", cell: "il", version: "test" });
  });

  it("echoes or creates a request id", async () => {
    const withId = await app.request("/health", { headers: { "x-request-id": "abc" } });
    expect(withId.headers.get("x-request-id")).toBe("abc");
    const without = await app.request("/health");
    expect(without.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns JSON 404s", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
