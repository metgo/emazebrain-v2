/**
 * Starts the API for end-to-end tests on a brand-new database, seeded with
 * synthetic data. The database is dropped when the process exits.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL is required for e2e");

const name = `emb_e2e_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const url = new URL(adminUrl);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();
process.env.AUTH_SECRET ??= `e2e-${randomUUID()}-${randomUUID()}`;
process.env.CELL = "e2e";

const api = fileURLToPath(new URL("../../api/", import.meta.url));
execFileSync(process.execPath, ["--experimental-strip-types", "scripts/seed-dev.ts"], { cwd: api, env: process.env, stdio: "inherit" });

let dropping = false;
async function drop() {
  if (dropping) return;
  dropping = true;
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.end();
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void drop().finally(() => process.exit(0));
  });
}

await import(new URL("../../api/src/server.ts", import.meta.url).href);
