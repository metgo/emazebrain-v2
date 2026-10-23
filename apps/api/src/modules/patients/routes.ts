/**
 * First vertical slice (design doc §5.3): list and view patients.
 * Everything runs under RLS; every read is written to the audit log (§6).
 * Responses carry only what the patient list needs.
 */
import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function patientRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();

  // ?clinic=<id> narrows the list to the clinic the user is working in
  // (design doc §4.2). It is a filter only: RLS still decides what is visible,
  // so naming a clinic the user doesn't belong to returns an empty list.
  r.get("/", async (c) => {
    const user = c.get("user");
    const clinic = c.req.query("clinic");
    if (clinic !== undefined && !UUID.test(clinic)) return c.json({ error: "invalid_clinic" }, 400);
    const patients = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.clinic_id, p.given_name, p.family_name, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.status
           FROM app.patient p
          WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR p.clinic_id = $1::uuid)
          ORDER BY p.family_name, p.given_name
          LIMIT 500`,
        [clinic ?? null],
      );
      // The clinic is recorded only if the user belongs to it, so a made-up id can't write into another clinic's log.
      await db.query(
        `SELECT app.record_audit('list', 'patient', NULL, NULL,
                CASE WHEN app.has_clinic_role($1::uuid, enum_range(NULL::app.member_role)) THEN $1::uuid END)`,
        [clinic ?? null],
      );
      return rows;
    });
    return c.json({ patients });
  });

  r.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const user = c.get("user");
    const patient = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT id, clinic_id, given_name, family_name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, status, preferred_locale
           FROM app.patient WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (rows[0]) await db.query(`SELECT app.record_audit('view', 'patient', $1, $1)`, [id]);
      return rows[0] ?? null;
    });
    // Same answer for "doesn't exist" and "not yours", so ids can't be probed.
    if (!patient) return c.json({ error: "not_found" }, 404);
    return c.json({ patient });
  });

  return r;
}
