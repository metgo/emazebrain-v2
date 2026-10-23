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
import { scheduleDates } from "../../../packages/contracts/src/protocols.ts";
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
    await signUp(`noam@${SYNTHETIC_EMAIL_DOMAIN}`, "Noam Shapiro"),
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
      // Tal, Shira and Noam share Yael's Tel Aviv caseload as secondary therapists.
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
  // eMazeBrain library templates (content pipeline in production) and a running protocol for a few patients.
  const steps = {
    starter: [
      { game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 180, lives: 3, difficulty_start: 2, hemisphere: "left", timer_position: "left", trial_window_ms: null },
      { game_id: "catch-me-if-you-can", session_mode: "timed", duration_s: 120, lives: null, difficulty_start: 2, hemisphere: "right", timer_position: "right", trial_window_ms: null },
    ],
    discrimination: [
      { game_id: "catch-me-if-you-can", session_mode: "lives", duration_s: null, lives: 5, difficulty_start: 3, hemisphere: "left", timer_position: "left", trial_window_ms: 8000 },
    ],
  };
  const progression = JSON.stringify({ metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 });
  const templates = [
    { id: uuidv7(), name: "Visual attention starter", description: "Two short rounds of Catch Me If You Can, one per hemisphere.", weeks: 4, perWeek: 2, steps: steps.starter },
    { id: uuidv7(), name: "Visual discrimination", description: "Finding smaller and smaller colour differences, with a time limit per board.", weeks: 6, perWeek: 3, steps: steps.discrimination },
  ];
  for (const t of templates) {
    await admin.query(
      `INSERT INTO app.protocol_template (id, name, description, weeks, sessions_per_week, setting, visibility) VALUES ($1,$2,$3,$4,$5,'clinic','platform')`,
      [t.id, t.name, t.description, t.weeks, t.perWeek],
    );
    for (const [i, st] of t.steps.entries()) {
      await admin.query(
        `INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, hemisphere, timer_position, practice, trial_window_ms, progression)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'auto',$10,$11)`,
        [t.id, i + 1, st.game_id, st.session_mode, st.duration_s, st.lives, st.difficulty_start, st.hemisphere, st.timer_position, st.trial_window_ms, progression],
      );
    }
  }
  const telAviv = clinics[0]!.id;
  const active = await admin.query<{ id: string }>(
    `SELECT id FROM app.patient WHERE clinic_id = $1 AND status = 'active' ORDER BY family_name, given_name LIMIT 4`,
    [telAviv],
  );
  const starter = templates[0]!;
  for (const [n, row] of active.rows.entries()) {
    const start = new Date(Date.now() - (n === 3 ? 2 : 0) * 86_400_000).toLocaleDateString("en-CA");
    const aid = uuidv7();
    await admin.query(
      `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, template_id, template_version, assigned_by, name, start_date, weeks, sessions_per_week)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9)`,
      [aid, row.id, telAviv, starter.id, yael, starter.name, start, starter.weeks, starter.perWeek],
    );
    for (const [i, st] of starter.steps.entries()) {
      await admin.query(
        `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice, trial_window_ms, progression)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'auto',$11,$12)`,
        [aid, row.id, i + 1, st.game_id, st.session_mode, st.duration_s, st.lives, st.difficulty_start, st.hemisphere, st.timer_position, st.trial_window_ms, progression],
      );
    }
    for (const s of scheduleDates(start, starter.weeks, starter.perWeek)) {
      await admin.query(`INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date) VALUES ($1,$2,$3,$4,$5,$6)`, [aid, row.id, telAviv, s.seq, s.week, s.date]);
    }
  }
  await admin.query("COMMIT");
  await pool.end();
  await authDb.end();
  console.log(`seed: created ${SEED.email}, dana@ and ronit@${SYNTHETIC_EMAIL_DOMAIN} (password "${SEED.password}"), 2 clinics, 19 synthetic patients`);
}
await admin.end();
