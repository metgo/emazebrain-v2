/**
 * Creates the spike databases and seeds deterministic synthetic data,
 * including the awkward cases where sync rules and RLS can drift apart.
 *
 *   ADMIN_URL=postgres://postgres@localhost:55432/postgres node --experimental-strip-types seed.ts
 *
 * Synthetic data only: no real names or patients (CLAUDE.md invariant 1).
 */
import pg from "pg";
import { writeFile } from "node:fs/promises";
import { migrate } from "../../packages/db/src/migrate.ts";

const ADMIN_URL = process.env.ADMIN_URL ?? "postgres://postgres@localhost:55432/postgres";
const SOURCE_DB = "emb_spike";
const STORAGE_DB = "emb_ps_storage";

// Deterministic PRNG so every run seeds the same world.
let state = 20261022;
const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const uuid = () => {
  const h = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function dbUrl(name: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export interface SeedSummary {
  users: Array<{ id: string; label: string }>;
  counts: Record<string, number>;
}

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const db of [SOURCE_DB, STORAGE_DB]) {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
  }
  await admin.end();

  const c = new pg.Client({ connectionString: dbUrl(SOURCE_DB) });
  await c.connect();
  await migrate(c);

  const orgs = [uuid(), uuid(), uuid()];
  for (const [i, id] of orgs.entries()) {
    await c.query(`INSERT INTO app.organization (id, name, region) VALUES ($1, $2, 'il')`, [id, `Org ${i + 1}`]);
  }
  const clinics: Array<{ id: string; org: string }> = [];
  for (let i = 0; i < 12; i++) {
    const org = orgs[i % 3]!;
    const id = uuid();
    clinics.push({ id, org });
    await c.query(
      `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,$3,'IL','Asia/Jerusalem')`,
      [id, org, `Clinic ${i + 1}`],
    );
  }

  const users: SeedSummary["users"] = [];
  const membersByClinic = new Map<string, string[]>();
  let revoked = 0, multiClinic = 0, orgWide = 0;
  for (let i = 0; i < 160; i++) {
    const id = uuid();
    const kind = i < 8 ? "org_admin_orgwide" : i < 20 ? "manager" : i < 136 ? "therapist" : i < 150 ? "assistant" : "no_membership";
    users.push({ id, label: kind });
    await c.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$3,'staff','active')`, [
      id, `user${i}@synthetic.test`, `Synthetic User ${i}`,
    ]);
    if (kind === "no_membership") continue;
    if (kind === "org_admin_orgwide") {
      orgWide++;
      await c.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,NULL,'org_admin')`, [id, pick(orgs)]);
      continue;
    }
    const role = kind === "manager" ? "clinic_manager" : kind;
    const nClinics = kind === "therapist" && chance(0.2) ? 2 : 1;
    if (nClinics > 1) multiClinic++;
    const chosen = new Set<string>();
    while (chosen.size < nClinics) chosen.add(pick(clinics).id);
    for (const clinicId of chosen) {
      const clinic = clinics.find((x) => x.id === clinicId)!;
      const status = chance(0.1) ? "revoked" : "active";
      if (status === "revoked") revoked++;
      await c.query(
        `INSERT INTO app.membership (user_id, organization_id, clinic_id, role, status) VALUES ($1,$2,$3,$4,$5)`,
        [id, clinic.org, clinicId, role, status],
      );
      if (role === "therapist" || role === "assistant") {
        membersByClinic.set(clinicId, [...(membersByClinic.get(clinicId) ?? []), id]);
      }
    }
  }

  let patients = 0, deleted = 0, ended = 0, foreign = 0;
  const allCarers = [...membersByClinic.values()].flat();
  for (const clinic of clinics) {
    for (let j = 0; j < 50; j++) {
      const id = uuid();
      const isDeleted = chance(0.05);
      if (isDeleted) deleted++;
      patients++;
      await c.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status, deleted_at)
         VALUES ($1,$2,$3,'Synthetic','2017-01-01','active',$4)`,
        [id, clinic.id, `Child ${patients}`, isDeleted ? new Date().toISOString() : null],
      );
      const carers = new Set<string>();
      const local = membersByClinic.get(clinic.id) ?? [];
      if (local.length) carers.add(pick(local));
      if (local.length > 1 && chance(0.3)) carers.add(pick(local));
      // Drift case: a care-team row pointing at someone with no membership in this clinic.
      if (allCarers.length && chance(0.05)) { carers.add(pick(allCarers)); foreign++; }
      for (const u of carers) {
        const isEnded = chance(0.1);
        if (isEnded) ended++;
        await c.query(
          `INSERT INTO app.patient_care_team (patient_id, user_id, ended_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, u, isEnded ? new Date().toISOString() : null],
        );
      }
    }
  }

  // PowerSync replicates through a publication named "powersync".
  await c.query(`CREATE PUBLICATION powersync FOR TABLE app.patient, app.patient_care_team, app.membership, app.clinic`);
  await c.end();

  const summary: SeedSummary = {
    users,
    counts: { users: users.length, clinics: clinics.length, patients, deleted, endedCareTeam: ended, foreignCareTeam: foreign, revokedMemberships: revoked, multiClinicTherapists: multiClinic, orgWideAdmins: orgWide },
  };
  await writeFile(new URL("./seed-summary.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log("Seeded", summary.counts);
}

await main();
