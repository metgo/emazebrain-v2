import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const port = Number(process.env.PORT ?? 8787);
const info = { cell: process.env.CELL ?? "local", version: process.env.APP_VERSION ?? "dev" };
const databaseUrl = required("DATABASE_URL");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const auth = createAuth(
  {
    databaseUrl,
    secret: required("AUTH_SECRET"),
    baseURL: process.env.BASE_URL ?? `http://localhost:${port}`,
    // Origins allowed to call the auth endpoints, e.g. the SPA's dev server (comma-separated).
    // AUTH_RATE_LIMIT=off only for automated end-to-end runs; API tests cover the limits themselves.
    ...(process.env.AUTH_RATE_LIMIT === "off" ? { rateLimit: false } : {}),
    ...(process.env.IP_HEADERS ? { ipAddressHeaders: process.env.IP_HEADERS.split(",").map((s) => s.trim()) } : {}),
    ...(process.env.TRUSTED_ORIGINS ? { trustedOrigins: process.env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()) } : {}),
  },
  pool,
);
const app = createApp(info, { pool, auth });

serve({ fetch: app.fetch, port }, (s) => {
  console.log(`api listening on :${s.port} (cell ${info.cell})`);
});
