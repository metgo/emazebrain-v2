/**
 * For every seeded user, compares the patients PowerSync syncs to that user
 * with the patients Postgres RLS lets that user read. Any difference is a
 * leak (synced but not allowed) or a gap (allowed but not synced).
 *
 *   ADMIN_URL=... PS_ENDPOINT=http://127.0.0.1:8080 PS_HS256_KEY=... node --experimental-strip-types compare.ts
 */
import pg from "pg";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SeedSummary } from "./seed.ts";

const ADMIN_URL = process.env.ADMIN_URL ?? "postgres://postgres@localhost:55432/postgres";
const ENDPOINT = process.env.PS_ENDPOINT ?? "http://127.0.0.1:8080";
const KEY = process.env.PS_HS256_KEY;
if (!KEY) throw new Error("PS_HS256_KEY is required");

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function token(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "spike" }));
  const payload = b64url(JSON.stringify({ sub, aud: "powersync-dev", iat: now, exp: now + 600 }));
  const sig = createHmac("sha256", Buffer.from(KEY!, "base64url")).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Downloads one complete checkpoint and returns the patient ids it contains. */
export async function syncedPatients(sub: string): Promise<Set<string>> {
  const res = await fetch(`${ENDPOINT}/sync/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${token(sub)}` },
    body: JSON.stringify({ raw_data: true, include_checksum: true, parameters: {} }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const live = new Map<string, boolean>();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.data?.data) {
        for (const op of msg.data.data) {
          if (op.object_type !== "patient") continue;
          if (op.op === "PUT") live.set(op.object_id, true);
          if (op.op === "REMOVE") live.delete(op.object_id);
        }
      }
      if (msg.checkpoint_complete) break outer;
    }
  }
  await reader.cancel().catch(() => {});
  return new Set(live.keys());
}

export async function rlsPatients(db: pg.Client, sub: string): Promise<Set<string>> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE emb_app");
    await db.query("SELECT set_config('app.user_id', $1, true)", [sub]);
    const { rows } = await db.query<{ id: string }>("SELECT id FROM app.patient");
    return new Set(rows.map((r) => r.id));
  } finally {
    await db.query("ROLLBACK");
  }
}

async function main() {
  const summary: SeedSummary = JSON.parse(await readFile(new URL("./seed-summary.json", import.meta.url), "utf8"));
  const u = new URL(ADMIN_URL);
  u.pathname = "/emb_spike";
  const db = new pg.Client({ connectionString: u.toString() });
  await db.connect();

  const byLabel = new Map<string, { users: number; mismatched: number; leaks: number; gaps: number }>();
  let totalLeaks = 0, totalGaps = 0, rowsCompared = 0;
  const examples: string[] = [];
  for (const user of summary.users) {
    const [synced, allowed] = await Promise.all([syncedPatients(user.id), rlsPatients(db, user.id)]);
    const leaks = [...synced].filter((id) => !allowed.has(id));
    const gaps = [...allowed].filter((id) => !synced.has(id));
    rowsCompared += allowed.size;
    totalLeaks += leaks.length;
    totalGaps += gaps.length;
    const s = byLabel.get(user.label) ?? { users: 0, mismatched: 0, leaks: 0, gaps: 0 };
    s.users++;
    if (leaks.length || gaps.length) {
      s.mismatched++;
      if (examples.length < 5) examples.push(`${user.label} ${user.id}: ${leaks.length} leaked, ${gaps.length} missing`);
    }
    s.leaks += leaks.length;
    s.gaps += gaps.length;
    byLabel.set(user.label, s);
  }
  await db.end();

  console.log(`Users checked: ${summary.users.length}, allowed patient rows compared: ${rowsCompared}`);
  console.table(Object.fromEntries(byLabel));
  console.log(`Leaks (synced but not allowed by RLS): ${totalLeaks}`);
  console.log(`Gaps (allowed by RLS but not synced): ${totalGaps}`);
  for (const e of examples) console.log("  e.g.", e);
  process.exitCode = totalLeaks || totalGaps ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
