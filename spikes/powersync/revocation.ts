/**
 * Measures how quickly access changes reach the sync layer (design doc §9.8:
 * revocations must take effect within 60 s). For each change, polls a fresh
 * checkpoint until it matches what RLS allows, then restores the data.
 */
import pg from "pg";
import { readFile } from "node:fs/promises";
import { rlsPatients, syncedPatients } from "./compare.ts";
import type { SeedSummary } from "./seed.ts";

const ADMIN_URL = process.env.ADMIN_URL ?? "postgres://postgres@localhost:55432/postgres";
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

async function timeUntilConsistent(db: pg.Client, userId: string, limitMs = 60_000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const [synced, allowed] = await Promise.all([syncedPatients(userId), rlsPatients(db, userId)]);
    if (sameSet(synced, allowed)) return Date.now() - start;
    if (Date.now() - start > limitMs) throw new Error(`Not consistent after ${limitMs} ms for ${userId}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const summary: SeedSummary = JSON.parse(await readFile(new URL("./seed-summary.json", import.meta.url), "utf8"));
  const u = new URL(ADMIN_URL);
  u.pathname = "/emb_spike";
  const db = new pg.Client({ connectionString: u.toString() });
  await db.connect();

  // A therapist who currently sees at least one patient.
  let therapist = "";
  for (const user of summary.users.filter((x) => x.label === "therapist")) {
    if ((await rlsPatients(db, user.id)).size > 0) { therapist = user.id; break; }
  }
  const [patient] = [...(await rlsPatients(db, therapist))];

  const cases: Array<{ name: string; change: string; undo: string; params: unknown[] }> = [
    {
      name: "Membership revoked",
      change: `UPDATE app.membership SET status = 'revoked' WHERE user_id = $1`,
      undo: `UPDATE app.membership SET status = 'active' WHERE user_id = $1`,
      params: [therapist],
    },
    {
      name: "Removed from care team",
      change: `UPDATE app.patient_care_team SET ended_at = now() WHERE user_id = $1 AND patient_id = '${patient}'`,
      undo: `UPDATE app.patient_care_team SET ended_at = NULL WHERE user_id = $1 AND patient_id = '${patient}'`,
      params: [therapist],
    },
    {
      name: "Patient archived",
      change: `UPDATE app.patient SET deleted_at = now() WHERE id = $1`,
      undo: `UPDATE app.patient SET deleted_at = NULL WHERE id = $1`,
      params: [patient],
    },
  ];

  console.log(`Therapist ${therapist}, patient ${patient}`);
  for (const c of cases) {
    const before = (await syncedPatients(therapist)).size;
    await db.query(c.change, c.params);
    const ms = await timeUntilConsistent(db, therapist);
    const after = (await syncedPatients(therapist)).size;
    await db.query(c.undo, c.params);
    const restoreMs = await timeUntilConsistent(db, therapist);
    console.log(`${c.name}: synced ${before} → ${after} patients; consistent after ${ms} ms; restore consistent after ${restoreMs} ms`);
  }
  await db.end();
}

await main();
