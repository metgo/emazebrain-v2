/** Slice 3 (design doc §5.4–5.5): who sees and edits templates, and assignments follow the patient. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";

const ids = {
  org: randomUUID(), clinic: randomUUID(), other: randomUUID(),
  yael: randomUUID(), dana: randomUUID(), ronit: randomUUID(), outsider: randomUUID(),
  platform: randomUUID(), privateT: randomUUID(), clinicT: randomUUID(), patient: randomUUID(), assignment: randomUUID(),
};

describe.skipIf(!ADMIN_URL)("protocols", () => {
  let db: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Org','il')`, [ids.org]);
    await db.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$3,'One','IL','Asia/Jerusalem'), ($2,$3,'Two','IL','Asia/Jerusalem')`, [ids.clinic, ids.other, ids.org]);
    for (const [id, n] of [[ids.yael, "y"], [ids.dana, "d"], [ids.ronit, "r"], [ids.outsider, "o"]] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$2,'staff','active')`, [id, `${n}@synthetic.test`]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$5,$6,'therapist'), ($2,$5,$6,'therapist'), ($3,$5,$6,'clinic_manager'), ($4,$5,$7,'therapist')`,
      [ids.yael, ids.dana, ids.ronit, ids.outsider, ids.org, ids.clinic, ids.other],
    );
    // A platform template from the content pipeline (superuser).
    await db.query(`INSERT INTO app.protocol_template (id, name, weeks, sessions_per_week, visibility) VALUES ($1,'Starter',4,2,'platform')`, [ids.platform]);
    await db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','active')`, [ids.patient, ids.clinic]);
    await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.yael]);
  });
  afterAll(async () => drop?.());

  const visible = (user: string) =>
    asUser(db, user, async (c) => (await c.query<{ id: string }>(`SELECT id FROM app.protocol_template ORDER BY name`)).rows.map((r) => r.id).sort(), { rollback: true });

  it("Yael's private template is hers; a clinic template is shared; platform templates are for everyone", async () => {
    await asUser(db, ids.yael, async (c) => {
      for (const [id, vis, name] of [[ids.privateT, "private", "Mine"], [ids.clinicT, "clinic", "Shared"]] as const) {
        await c.query(
          `INSERT INTO app.protocol_template (id, organization_id, clinic_id, owner_user_id, name, weeks, sessions_per_week, visibility) VALUES ($1,$2,$3,$4,$5,6,2,$6)`,
          [id, ids.org, ids.clinic, ids.yael, name, vis],
        );
        await c.query(`INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s, lives) VALUES ($1,1,'catch-me-if-you-can','timed_lives',300,3)`, [id]);
      }
    });
    expect(await visible(ids.yael)).toEqual([ids.platform, ids.privateT, ids.clinicT].sort());
    expect(await visible(ids.dana)).toEqual([ids.platform, ids.clinicT].sort());
    expect(await visible(ids.ronit)).toEqual([ids.platform, ids.privateT, ids.clinicT].sort()); // managers see the clinic's templates
    expect(await visible(ids.outsider)).toEqual([ids.platform]);
  });

  it("only the owner or a manager edits; nobody edits platform templates; steps obey the mode rules", async () => {
    const rename = (user: string, id: string) =>
      asUser(db, user, async (c) => (await c.query(`UPDATE app.protocol_template SET name = 'x' WHERE id = $1`, [id])).rowCount, { rollback: true });
    expect(await rename(ids.yael, ids.clinicT)).toBe(1);
    expect(await rename(ids.dana, ids.clinicT)).toBe(0);
    expect(await rename(ids.ronit, ids.clinicT)).toBe(1);
    expect(await rename(ids.yael, ids.platform)).toBe(0);
    await expect(
      asUser(db, ids.yael, (c) => c.query(`INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, lives) VALUES ($1,2,'catch-me-if-you-can','timed',3)`, [ids.privateT]), { rollback: true }),
    ).rejects.toThrow(/step_mode_fields/);
    await expect(
      asUser(db, ids.dana, (c) => c.query(`INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s) VALUES ($1,2,'catch-me-if-you-can','timed',60)`, [ids.clinicT]), { rollback: true }),
    ).rejects.toThrow(/row-level security/);
  });

  it("assignments, their steps and schedule are seen exactly like the patient", async () => {
    await asUser(db, ids.yael, async (c) => {
      await c.query(
        `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, template_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,$4,$5,'Shared',current_date,6,2)`,
        [ids.assignment, ids.patient, ids.clinic, ids.clinicT, ids.yael],
      );
      await c.query(
        `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice)
         VALUES ($1,$2,1,'catch-me-if-you-can','timed_lives',300,3,3,3,'left','left','auto')`,
        [ids.assignment, ids.patient],
      );
      await c.query(`INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date) VALUES ($1,$2,$3,1,1,current_date)`, [ids.assignment, ids.patient, ids.clinic]);
    });
    const counts = (user: string) =>
      asUser(
        db,
        user,
        async (c) =>
          (await c.query(`SELECT (SELECT count(*) FROM app.protocol_assignment)::int a, (SELECT count(*) FROM app.assignment_step)::int s, (SELECT count(*) FROM app.planned_session)::int p`)).rows[0],
        { rollback: true },
      );
    expect(await counts(ids.yael)).toEqual({ a: 1, s: 1, p: 1 });
    expect(await counts(ids.ronit)).toEqual({ a: 1, s: 1, p: 1 });
    expect(await counts(ids.dana)).toEqual({ a: 0, s: 0, p: 0 });
    // A second running protocol for the same patient is refused.
    await expect(
      asUser(db, ids.yael, (c) =>
        c.query(`INSERT INTO app.protocol_assignment (patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,'Again',current_date,1,1)`, [ids.patient, ids.clinic, ids.yael]),
      ),
    ).rejects.toThrow(/assignment_one_running_uq/);
    // Dana can't assign to a patient she can't see.
    await expect(
      asUser(db, ids.dana, (c) =>
        c.query(`INSERT INTO app.protocol_assignment (patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,'Nope',current_date,1,1)`, [ids.patient, ids.clinic, ids.dana]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
