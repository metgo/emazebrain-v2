/**
 * Slice 1 (design doc §5.3, §6, §11.3): creating patients, guardians and
 * consent under RLS, archiving rules, and consent unlocking sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";

const ids = {
  org: randomUUID(), clinic: randomUUID(), otherClinic: randomUUID(),
  yael: randomUUID(), dana: randomUUID(), ronit: randomUUID(), outsider: randomUUID(),
  patient: randomUUID(), guardian: randomUUID(), foreignGuardian: randomUUID(),
};

describe.skipIf(!ADMIN_URL)("patients, guardians and consent", () => {
  let db: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Org','il')`, [ids.org]);
    await db.query(
      `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
       VALUES ($1,$3,'One','IL','Asia/Jerusalem'), ($2,$3,'Two','IL','Asia/Jerusalem')`,
      [ids.clinic, ids.otherClinic, ids.org],
    );
    for (const [id, name] of [[ids.yael, "Yael"], [ids.dana, "Dana"], [ids.ronit, "Ronit"], [ids.outsider, "Out"]] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$3,'staff','active')`, [id, `${name}@synthetic.test`, name]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES
         ($1,$5,$6,'therapist'), ($2,$5,$6,'therapist'), ($3,$5,$6,'clinic_manager'), ($4,$5,$7,'therapist')`,
      [ids.yael, ids.dana, ids.ronit, ids.outsider, ids.org, ids.clinic, ids.otherClinic],
    );
  });
  afterAll(async () => drop?.());

  const seesPatient = (user: string) =>
    asUser(db, user, async (c) => (await c.query(`SELECT 1 FROM app.patient WHERE id = $1`, [ids.patient])).rowCount === 1, { rollback: true });

  it("a therapist adds a patient and puts herself on the care team in one go", async () => {
    await asUser(db, ids.yael, async (c) => {
      await c.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, created_by) VALUES ($1,$2,'Noa','Levi','2018-03-01',$3)`,
        [ids.patient, ids.clinic, ids.yael],
      );
      await c.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.yael]);
    });
    expect(await seesPatient(ids.yael)).toBe(true);
    expect(await seesPatient(ids.dana)).toBe(false);
    expect(await seesPatient(ids.ronit)).toBe(true);
    // Dana can't join Noa's care team on her own.
    await expect(
      asUser(db, ids.dana, (c) => c.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.dana])),
    ).rejects.toThrow(/row-level security/);
    // Nor can a team member add someone from another clinic.
    await expect(
      asUser(db, ids.yael, (c) => c.query(`INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'secondary')`, [ids.patient, ids.outsider])),
    ).rejects.toThrow(/row-level security/);
  });

  it("warns about duplicates without revealing anything else", async () => {
    const dup = (user: string, clinic = ids.clinic, given = " noa ") =>
      asUser(db, user, async (c) => (await c.query(`SELECT app.patient_duplicate_exists($1,$2,'LEVI','2018-03-01') AS d`, [clinic, given])).rows[0].d, { rollback: true });
    expect(await dup(ids.dana)).toBe(true); // Dana can't see Noa, but is warned before adding her twice
    expect(await dup(ids.dana, ids.clinic, "Maya")).toBe(false);
    expect(await dup(ids.outsider)).toBe(false); // another clinic learns nothing
  });

  it("only a clinic manager archives or restores; archived patients disappear for therapists", async () => {
    await expect(asUser(db, ids.yael, (c) => c.query(`UPDATE app.patient SET deleted_at = now() WHERE id = $1`, [ids.patient]))).rejects.toThrow(/only a clinic manager/);
    await asUser(db, ids.ronit, (c) => c.query(`UPDATE app.patient SET deleted_at = now() WHERE id = $1`, [ids.patient]));
    expect(await seesPatient(ids.yael)).toBe(false);
    expect(await seesPatient(ids.ronit)).toBe(true);
    await asUser(db, ids.ronit, (c) => c.query(`UPDATE app.patient SET deleted_at = NULL WHERE id = $1`, [ids.patient]));
    expect(await seesPatient(ids.yael)).toBe(true);
  });

  it("guardians are visible to the staff who can see their children, and links stay inside one clinic", async () => {
    await asUser(db, ids.yael, async (c) => {
      await c.query(`INSERT INTO app.guardian (id, clinic_id, full_name, phone, created_by) VALUES ($1,$2,'Miri Levi','+972 50 000 0000',$3)`, [ids.guardian, ids.clinic, ids.yael]);
      await c.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship) VALUES ($1,$2,'mother')`, [ids.guardian, ids.patient]);
    });
    const seesGuardian = (user: string) =>
      asUser(db, user, async (c) => (await c.query(`SELECT 1 FROM app.guardian WHERE id = $1`, [ids.guardian])).rowCount === 1, { rollback: true });
    expect(await seesGuardian(ids.yael)).toBe(true);
    expect(await seesGuardian(ids.ronit)).toBe(true);
    expect(await seesGuardian(ids.dana)).toBe(false);
    expect(await seesGuardian(ids.outsider)).toBe(false);

    await asUser(db, ids.outsider, (c) =>
      c.query(`INSERT INTO app.guardian (id, clinic_id, full_name, created_by) VALUES ($1,$2,'Other',$3)`, [ids.foreignGuardian, ids.otherClinic, ids.outsider]),
    );
    // Yael can't link a guardian from another clinic to her patient (she can't even see it, and the policy checks clinics).
    await expect(
      asUser(db, ids.yael, (c) => c.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship) VALUES ($1,$2,'father')`, [ids.foreignGuardian, ids.patient])),
    ).rejects.toThrow(/row-level security/);
  });

  it("consent from a linked guardian unlocks sessions; withdrawing it locks them again", async () => {
    const state = async () =>
      (await db.query(`SELECT p.status, app.patient_can_play(p.id) AS can_play FROM app.patient p WHERE id = $1`, [ids.patient])).rows[0];
    expect(await state()).toEqual({ status: "pending_consent", can_play: false });

    const give = (decision: string, guardian = ids.guardian) =>
      asUser(db, ids.yael, (c) =>
        c.query(
          `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, record_hash)
           VALUES ($1,$2,'treatment',$3,'draft-2026-10','in_clinic_esign','he','Miri Levi',$4,'\\x00')`,
          [ids.patient, guardian, decision, ids.yael],
        ),
      );
    // A guardian who isn't linked to the child can't sign.
    await expect(give("granted", ids.foreignGuardian)).rejects.toThrow(/row-level security/);

    await give("granted");
    expect(await state()).toEqual({ status: "active", can_play: true });
    const { rows } = await db.query(`SELECT encode(record_hash, 'hex') AS h FROM app.consent WHERE patient_id = $1`, [ids.patient]);
    expect(rows[0].h).toMatch(/^[0-9a-f]{64}$/); // computed by the database, not the '\x00' the caller sent

    await give("withdrawn");
    expect(await state()).toEqual({ status: "pending_consent", can_play: false });
    const current = await asUser(db, ids.yael, async (c) => (await c.query(`SELECT decision FROM app.consent_current WHERE patient_id = $1 AND purpose = 'treatment'`, [ids.patient])).rows, { rollback: true });
    expect(current).toEqual([{ decision: "withdrawn" }]);
  });

  it("audits guardian records and links", async () => {
    const { rows } = await db.query(
      `SELECT resource_type, action FROM app.audit_event WHERE resource_type IN ('guardian', 'guardian_patient') AND actor_user_id = $1 ORDER BY chain_seq`,
      [ids.yael],
    );
    expect(rows).toEqual([
      { resource_type: "guardian", action: "create" },
      { resource_type: "guardian_patient", action: "create" },
    ]);
  });
});
