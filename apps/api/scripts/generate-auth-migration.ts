/**
 * Prints the SQL Better Auth needs for its tables, so it can be reviewed and
 * committed as a normal migration (packages/db/migrations). Run against an
 * empty database that already has schema `auth`:
 *
 *   DATABASE_URL=... node --experimental-strip-types scripts/generate-auth-migration.ts
 */
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";
import { createAuth } from "../src/auth.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const auth = createAuth({ databaseUrl: url, secret: "x".repeat(32), baseURL: "http://localhost" }, new pg.Pool({ connectionString: url }));
const { compileMigrations } = await getMigrations(auth.options);
console.log(await compileMigrations());
process.exit(0);
