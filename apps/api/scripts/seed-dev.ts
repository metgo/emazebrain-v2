/**
 * Local development seed. Synthetic data only (CLAUDE.md invariant 1).
 *
 *   DATABASE_URL=postgres://… AUTH_SECRET=… node --experimental-strip-types scripts/seed-dev.ts
 *
 * Creates one organization with two clinics, a therapist who works in both,
 * and synthetic patients on her caseload. Safe to re-run: it stops if the
 * therapist already exists. Two-step sign-in is set up in the app on first
 * sign-in, exactly as a real therapist would.
 */
import pg from "pg";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { SYNTHETIC_EMAIL_DOMAIN, syntheticPatients } from "../../../packages/db/src/synthetic.ts";
import { authPool, createAuth } from "../src/auth.ts";
import { uuidv7 } from "../src/ids.ts";

const url = process.env.DATABASE_URL;
const secret = process.env.AUTH_SECRET;
if (!url || !secret) throw new Error("DATABASE_URL and AUTH_SECRET are required");

export const SEED = {
  email: process.env.SEED_EMAIL ?? `yael@${SYNTHETIC_EMAIL_DOMAIN}`,
  password: process.env.SEED_PASSWORD ?? "correct horse battery staple",
  name: "Yael Bar",
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();
await migrate(admin);

const existing = await admin.query(`SELECT id FROM app.app_user WHERE email = $1`, [SEED.email]);
if (existing.rowCount) {
  console.log(`seed: ${SEED.email} already exists, nothing to do`);
} else {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const authDb = authPool(url);
  const auth = createAuth({ databaseUrl: url, secret, baseURL: "http://localhost:8787", pool: authDb, rateLimit: false }, pool);
  const { user } = await auth.api.signUpEmail({ body: { email: SEED.email, password: SEED.password, name: SEED.name } });

  const org = uuidv7();
  const clinics = [
    { id: uuidv7(), name: "Tel Aviv Child Development Center" },
    { id: uuidv7(), name: "Haifa North Clinic" },
  ];
  await admin.query("BEGIN");
  await admin.query(`INSERT INTO app.organization (id, name, region) VALUES ($1, 'Synthetic Health Network', 'il')`, [org]);
  for (const [i, c] of clinics.entries()) {
    await admin.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,$3,'IL','Asia/Jerusalem')`, [c.id, org, c.name]);
    await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [user.id, org, c.id]);
    const people = syntheticPatients(i === 0 ? 14 : 5, { seed: 7 + i, locale: i === 0 ? "mixed" : "he" });
    for (const p of people) {
      const id = uuidv7();
      await admin.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status, preferred_locale)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, c.id, p.given_name, p.family_name, p.date_of_birth, p.status, p.preferred_locale],
      );
      await admin.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, user.id]);
    }
  }
  await admin.query("COMMIT");
  await pool.end();
  await authDb.end();
  console.log(`seed: created ${SEED.email} / "${SEED.password}" with 2 clinics and 19 synthetic patients`);
}
await admin.end();
