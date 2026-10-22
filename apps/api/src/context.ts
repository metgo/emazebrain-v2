/**
 * Request context: who is calling, and a database transaction that runs as
 * the app role under RLS with app.user_id set (CLAUDE.md invariant 3).
 */
import type { MiddlewareHandler } from "hono";
import type pg from "pg";
import type { Auth } from "./auth.ts";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

export type Env = {
  Variables: {
    requestId: string;
    user: SessionUser;
  };
};

/**
 * Runs fn in one transaction as role emb_app with app.user_id and
 * app.request_id set for this transaction only. RLS decides what the user can
 * see; the API never filters by a client-supplied clinic id.
 */
export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  requestId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE emb_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [userId, requestId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Requires a signed-in staff user who has turned on two-factor authentication
 * (§11.2: MFA mandatory for all staff). Without it every /v1 route answers
 * 403 mfa_required, so the app can send the user to the enrolment screen.
 */
export function requireStaffSession(auth: Auth): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    const user = session.user as SessionUser;
    if (!user.twoFactorEnabled) return c.json({ error: "mfa_required" }, 403);
    c.set("user", { id: user.id, email: user.email, name: user.name, twoFactorEnabled: true });
    await next();
  };
}
