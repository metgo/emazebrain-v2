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
  { databaseUrl, secret: required("AUTH_SECRET"), baseURL: process.env.BASE_URL ?? `http://localhost:${port}` },
  pool,
);
const app = createApp(info, { pool, auth });

serve({ fetch: app.fetch, port }, (s) => {
  console.log(`api listening on :${s.port} (cell ${info.cell})`);
});
