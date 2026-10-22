import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.ts";

export const ADMIN_URL = process.env.DATABASE_URL;

/** Creates a throwaway database, migrates it, and returns a superuser client plus a cleanup function. */
export async function freshDatabase(): Promise<{ db: pg.Client; url: string; drop: () => Promise<void> }> {
  const name = `emb_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await migrate(db);

  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Runs fn as the application role with app.user_id set; commits unless rollback is requested. */
export async function asUser<T>(
  db: pg.Client,
  userId: string,
  fn: (c: pg.Client) => Promise<T>,
  opts: { rollback?: boolean; requestId?: string } = {},
): Promise<T> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE emb_app");
    await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    if (opts.requestId) await db.query("SELECT set_config('app.request_id', $1, true)", [opts.requestId]);
    const out = await fn(db);
    await db.query(opts.rollback ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}
