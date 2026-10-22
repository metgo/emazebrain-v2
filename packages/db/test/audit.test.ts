/**
 * Audit log (design doc §6, §10.5): writes to patient data are recorded by
 * trigger with column names only; reads are recorded through record_audit();
 * rows are append-only and hash-chained so tampering is detectable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";

const ids = {
  org: randomUUID(), clinic: randomUUID(), otherClinic: randomUUID(),
  therapist: randomUUID(), manager: randomUUID(), otherManager: randomUUID(),
  patient: randomUUID(), otherPatient: randomUUID(),
};
let db: pg.Client;
let drop: () => Promise<void>;

describe.skipIf(!ADMIN_URL)("audit log", () => {
  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1, 'Org', 'il')`, [ids.org]);
    await db.query(
      `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
       VALUES ($1,$3,'A','IL','Asia/Jerusalem'), ($2,$3,'B','IL','Asia/Jerusalem')`,
      [ids.clinic, ids.otherClinic, ids.org],
    );
    for (const [id, n] of [[ids.therapist, "t"], [ids.manager, "m"], [ids.otherManager, "o"]] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$2,'staff','active')`, [id, `${n}@synthetic.test`]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES
        ($1,$4,$5,'therapist'), ($2,$4,$5,'clinic_manager'), ($3,$4,$6,'clinic_manager')`,
      [ids.therapist, ids.manager, ids.otherManager, ids.org, ids.clinic, ids.otherClinic],
    );
    await db.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status)
       VALUES ($1,$3,'Child','One','2018-01-01','active'), ($2,$4,'Child','Two','2018-01-01','active')`,
      [ids.patient, ids.otherPatient, ids.clinic, ids.otherClinic],
    );
    await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.therapist]);
  });
  afterAll(async () => { if (drop) await drop(); });

  it("records every write to patient data, attributed to the system when no user is set", async () => {
    const { rows } = await db.query(
      `SELECT action, resource_type, actor_user_id FROM app.audit_event WHERE resource_type = 'patient' ORDER BY chain_seq`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "create" && r.actor_user_id === null)).toBe(true);
  });

  it("logs the names of changed columns, never their values, and the acting user", async () => {
    const requestId = randomUUID();
    await asUser(db, ids.therapist, (c) => c.query(`UPDATE app.patient SET given_name = 'Renamed' WHERE id = $1`, [ids.patient]), { requestId });
    const { rows } = await db.query(
      `SELECT * FROM app.audit_event WHERE resource_id = $1 AND action = 'update'`,
      [ids.patient],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: ids.therapist, patient_id: ids.patient, clinic_id: ids.clinic,
      changed_fields: ["given_name"], request_id: requestId,
    });
    const all = JSON.stringify((await db.query(`SELECT * FROM app.audit_event`)).rows);
    expect(all).not.toContain("Renamed");
  });

  it("records archiving as a delete", async () => {
    await asUser(db, ids.manager, (c) => c.query(`UPDATE app.patient SET deleted_at = now() WHERE id = $1`, [ids.patient]));
    const { rows } = await db.query(`SELECT action FROM app.audit_event WHERE resource_id = $1 ORDER BY chain_seq DESC LIMIT 1`, [ids.patient]);
    expect(rows[0]?.action).toBe("delete");
    await db.query(`UPDATE app.patient SET deleted_at = NULL WHERE id = $1`, [ids.patient]);
  });

  it("lets the app record reads, but only as the session user", async () => {
    await asUser(db, ids.therapist, (c) => c.query(`SELECT app.record_audit('view', 'patient', $1, $1)`, [ids.patient]));
    const { rows } = await db.query(`SELECT actor_user_id, clinic_id FROM app.audit_event WHERE action = 'view'`);
    expect(rows).toEqual([{ actor_user_id: ids.therapist, clinic_id: ids.clinic }]);
  });

  it("never lets the app insert, change or delete audit rows directly", async () => {
    await expect(asUser(db, ids.therapist, (c) =>
      c.query(`INSERT INTO app.audit_event (chain_seq, action, resource_type, prev_hash, hash) VALUES (999, 'view', 'x', '\\x00', '\\x00')`),
    )).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ids.manager, (c) => c.query(`DELETE FROM app.audit_event`))).rejects.toThrow(/permission denied/);
    await expect(db.query(`UPDATE app.audit_event SET reason = 'x'`)).rejects.toThrow(/append-only/); // even a superuser
  });

  it("shows users their own actions and managers their clinic, nothing else", async () => {
    const seen = (user: string) =>
      asUser(db, user, async (c) => (await c.query<{ clinic_id: string | null; actor_user_id: string | null }>(`SELECT clinic_id, actor_user_id FROM app.audit_event`)).rows, { rollback: true });
    const manager = await seen(ids.manager);
    expect(manager.length).toBeGreaterThan(0);
    expect(manager.every((r) => r.clinic_id === ids.clinic || r.actor_user_id === ids.manager)).toBe(true);
    const other = await seen(ids.otherManager);
    expect(other.some((r) => r.clinic_id === ids.clinic)).toBe(false);
    const therapist = await seen(ids.therapist);
    expect(therapist.every((r) => r.actor_user_id === ids.therapist)).toBe(true);
  });

  it("keeps an unbroken hash chain, and detects tampering done behind the app's back", async () => {
    expect((await db.query(`SELECT * FROM app.verify_audit_chain()`)).rows).toEqual([]);
    await expect(asUser(db, ids.manager, (c) => c.query(`SELECT * FROM app.verify_audit_chain()`), { rollback: true })).rejects.toThrow(/permission denied/);

    // A DBA disables the guard and quietly edits history.
    await db.query(`ALTER TABLE app.audit_event DISABLE TRIGGER audit_append_only`);
    const { rows } = await db.query<{ chain_seq: string }>(`UPDATE app.audit_event SET actor_user_id = NULL WHERE action = 'view' RETURNING chain_seq`);
    await db.query(`ALTER TABLE app.audit_event ENABLE TRIGGER audit_append_only`);
    const broken = (await db.query<{ broken_seq: string }>(`SELECT * FROM app.verify_audit_chain()`)).rows.map((r) => r.broken_seq);
    expect(broken).toEqual([rows[0]!.chain_seq]);
  });
});
