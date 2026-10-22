import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("api", () => {
  const app = createApp({ cell: "il", version: "test" });

  it("reports health with the cell name", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", cell: "il", version: "test" });
  });

  it("echoes a valid request id, or creates one", async () => {
    const id = "0192f3a0-1c2b-7d3e-8f40-123456789abc";
    const withId = await app.request("/health", { headers: { "x-request-id": id } });
    expect(withId.headers.get("x-request-id")).toBe(id);
    const junk = await app.request("/health", { headers: { "x-request-id": "not-a-uuid" } });
    expect(junk.headers.get("x-request-id")).not.toBe("not-a-uuid");
    const without = await app.request("/health");
    expect(without.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns JSON 404s", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
