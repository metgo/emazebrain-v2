import { Hono } from "hono";

export interface AppInfo {
  cell: string;
  version: string;
}

/**
 * API Service (design doc §9.1, C9). Phase 0 only exposes health; modules are
 * added under src/modules/<module>/{routes,service,repo,policy}.ts.
 */
export function createApp(info: AppInfo) {
  const app = new Hono();

  // Every response carries a request id for logs and audit (no patient data in logs).
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", cell: info.cell, version: info.version }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}
