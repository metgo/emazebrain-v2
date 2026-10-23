/**
 * Local development seed. Synthetic data only (CLAUDE.md invariant 1).
 *
 *   DATABASE_URL=postgres://… AUTH_SECRET=… node --experimental-strip-types scripts/seed-dev.ts
 *
 * Creates one organization with two clinics; Yael (therapist in both), Dana
 * (therapist) and Ronit (clinic manager) in Tel Aviv; synthetic patients on
 * Yael's caseload, each with a synthetic parent, and consent where the
 * patient is active. Safe to re-run: it stops if the
 * therapist already exists. Two-step sign-in is set up in the app on first
 * sign-in, exactly as a real therapist would.
 */
import pg from "pg";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { SYNTHETIC_EMAIL_DOMAIN, syntheticGuardian, syntheticPatients } from "../../../packages/db/src/synthetic.ts";
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
  const signUp = async (email: string, name: string) =>
    (await auth.api.signUpEmail({ body: { email, password: SEED.password, name } })).user.id;
  const yael = await signUp(SEED.email, SEED.name);
  const dana = await signUp(`dana@${SYNTHETIC_EMAIL_DOMAIN}`, "Dana Kaplan");
  const ronit = await signUp(`ronit@${SYNTHETIC_EMAIL_DOMAIN}`, "Ronit Avraham");
  // More therapists, so each end-to-end journey can sign in as its own person.
  const extra = [
    await signUp(`gil@${SYNTHETIC_EMAIL_DOMAIN}`, "Gil Mizrahi"),
    await signUp(`tal@${SYNTHETIC_EMAIL_DOMAIN}`, "Tal Peretz"),
    await signUp(`shira@${SYNTHETIC_EMAIL_DOMAIN}`, "Shira Ben David"),
  ];

  const org = uuidv7();
  const clinics = [
    { id: uuidv7(), name: "Tel Aviv Child Development Center" },
    { id: uuidv7(), name: "Haifa North Clinic" },
  ];
  await admin.query("BEGIN");
  await admin.query(`INSERT INTO app.organization (id, name, region) VALUES ($1, 'Synthetic Health Network', 'il')`, [org]);
  for (const [i, c] of clinics.entries()) {
    await admin.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,$3,'IL','Asia/Jerusalem')`, [c.id, org, c.name]);
    await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [yael, org, c.id]);
    if (i === 0) {
      await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist'), ($4,$2,$3,'clinic_manager')`, [dana, org, c.id, ronit]);
      for (const u of extra) await admin.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [u, org, c.id]);
    }
    const people = syntheticPatients(i === 0 ? 14 : 5, { seed: 7 + i, locale: i === 0 ? "mixed" : "he" });
    for (const [n, p] of people.entries()) {
      const id = uuidv7();
      await admin.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, preferred_locale, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, c.id, p.given_name, p.family_name, p.date_of_birth, p.preferred_locale, yael],
      );
      await admin.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, yael]);
      // Tal and Shira share Yael's Tel Aviv caseload as secondary therapists.
      if (i === 0) for (const u of extra.slice(1)) await admin.query(`INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'secondary')`, [id, u]);
      const g = syntheticGuardian(p, 1000 * (i + 1) + n);
      const gid = uuidv7();
      await admin.query(
        `INSERT INTO app.guardian (id, clinic_id, full_name, phone, preferred_locale, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gid, c.id, g.full_name, g.phone, p.preferred_locale, yael],
      );
      await admin.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship) VALUES ($1,$2,$3)`, [gid, id, g.relationship]);
      // Consent drives status: active and inactive patients have consent for clinic sessions.
      if (p.status === "active" || p.status === "inactive") {
        await admin.query(
          `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, record_hash)
           VALUES ($1,$2,'treatment','granted','draft-2026-10','in_clinic_esign',$3,$4,$5,'\\x')`,
          [id, gid, p.preferred_locale, g.full_name, yael],
        );
      }
      if (p.status === "inactive" || p.status === "consent_legacy") {
        await admin.query(`UPDATE app.patient SET status = $2 WHERE id = $1`, [id, p.status]);
      }
    }
  }
  await admin.query("COMMIT");
  await pool.end();
  await authDb.end();
  console.log(`seed: created ${SEED.email}, dana@ and ronit@${SYNTHETIC_EMAIL_DOMAIN} (password "${SEED.password}"), 2 clinics, 19 synthetic patients`);
}
await admin.end();
