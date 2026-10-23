/** Clinic team (design doc §5.2): who works here, for managers' pickers and the Team page. */
import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";
import { UUID } from "../patients/routes.ts";

export function clinicRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  r.get("/:id/staff", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const staff = await withUser(pool, c.get("user").id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.full_name, u.email, array_agg(m.role::text ORDER BY m.role) AS roles
           FROM app.membership m JOIN app.app_user u ON u.id = m.user_id
          WHERE m.clinic_id = $1 AND m.status = 'active' AND u.deleted_at IS NULL
          GROUP BY u.id, u.full_name, u.email
          ORDER BY u.full_name`,
        [id],
      );
      return rows;
    });
    return c.json({ staff });
  });
  return r;
}
