/**
 * End to end against a real Postgres: sign up → blocked until MFA → enable
 * TOTP → sign in again with password + code → read patients under RLS, with
 * every read written to the audit log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { createApp } from "../src/app.ts";
import { authPool, createAuth } from "../src/auth.ts";
import { uuidv7 } from "../src/ids.ts";

const ADMIN_URL = process.env.DATABASE_URL;
const BASE = "http://localhost:8787";
const dbName = `emb_api_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

// ---- RFC 6238 TOTP, so the test can act like an authenticator app.
function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}
function totp(secretB32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}

// ---- A tiny cookie-keeping client around app.request().
type App = ReturnType<typeof createApp>;
function client(app: App) {
  const jar = new Map<string, string>();
  return async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ origin: BASE });
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await app.request(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair!.split("=");
      const value = v.join("=");
      if (/max-age=0/i.test(c) || value === "") jar.delete(k!.trim());
      else jar.set(k!.trim(), value);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

describe.skipIf(!ADMIN_URL)("sign-in with MFA, then patients under RLS", () => {
  let pool: pg.Pool;
  let authDb: pg.Pool;
  let super_: pg.Client;
  let app: App;
  let limited: App;
  const email = "yael@synthetic.test";
  const password = "correct horse battery staple";
  let userId = "";
  let secret = "";
  const ids = { org: uuidv7(), clinic: uuidv7(), mine: uuidv7(), notMine: uuidv7() };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    super_ = new pg.Client({ connectionString: url.toString() });
    await super_.connect();
    await migrate(super_);

    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
    authDb = authPool(url.toString());
    const secret = randomUUID() + randomUUID();
    const base = { databaseUrl: url.toString(), secret, baseURL: BASE, pool: authDb };
    const auth = createAuth({ ...base, rateLimit: false }, pool);
    limited = createApp({ cell: "test", version: "test" }, { pool, auth: createAuth(base, pool) });
    app = createApp({ cell: "test", version: "test" }, { pool, auth });
  });

  afterAll(async () => {
    await pool?.end();
    await authDb?.end();
    await super_?.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it("signs a therapist up and mirrors them into app.app_user with a UUIDv7 id", async () => {
    const api = client(app);
    const res = await api("/api/auth/sign-up/email", { method: "POST", body: { email, password, name: "Yael" } });
    expect(res.status).toBe(200);
    userId = res.body.user.id;
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const { rows } = await super_.query(`SELECT email FROM app.app_user WHERE id = $1`, [userId]);
    expect(rows[0]?.email).toBe(email);

    // Seed a clinic where Yael is a therapist with one patient on her care team (superuser, bypasses RLS).
    await super_.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Org','il')`, [ids.org]);
    await super_.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,'Clinic','IL','Asia/Jerusalem')`, [ids.clinic, ids.org]);
    await super_.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,$3,'therapist')`, [userId, ids.org, ids.clinic]);
    await super_.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status)
       VALUES ($1,$3,'Noa','Synthetic','2018-03-01','active'), ($2,$3,'Daniel','Synthetic','2016-07-12','active')`,
      [ids.mine, ids.notMine, ids.clinic],
    );
    await super_.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.mine, userId]);
  });

  it("refuses patient data until two-factor is on", async () => {
    const api = client(app);
    expect((await api("/v1/patients")).status).toBe(401);
    await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    const res = await api("/v1/patients");
    expect(res).toEqual({ status: 403, body: { error: "mfa_required" } });
  });

  it("enrols TOTP, then requires the code at the next sign-in", async () => {
    const api = client(app);
    await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    const enable = await api("/api/auth/two-factor/enable", { method: "POST", body: { password } });
    expect(enable.status).toBe(200);
    expect(enable.body.backupCodes.length).toBeGreaterThan(0);
    secret = new URL(enable.body.totpURI).searchParams.get("secret")!;
    expect((await api("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } })).status).toBe(200);
    await api("/api/auth/sign-out", { method: "POST", body: {} });

    const next = client(app);
    const signIn = await next("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    expect(signIn.body.twoFactorRedirect).toBe(true);
    expect((await next("/v1/patients")).status).toBe(401); // password alone is not a session

    const wrong = await next("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: "000000" } });
    expect(wrong.status).not.toBe(200);
    const ok = await next("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } });
    expect(ok.status).toBe(200);

    const me = await next("/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.memberships).toEqual([expect.objectContaining({ clinic_id: ids.clinic, role: "therapist", clinic_name: "Clinic" })]);
  });

  it("lists only care-team patients, hides others as not found, and audits every read", async () => {
    const api = client(app);
    await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    await api("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } });

    const list = await api("/v1/patients");
    expect(list.status).toBe(200);
    expect(list.body.patients.map((p: { id: string }) => p.id)).toEqual([ids.mine]);

    expect((await api(`/v1/patients/${ids.mine}`)).status).toBe(200);
    expect(await api(`/v1/patients/${ids.notMine}`)).toEqual({ status: 404, body: { error: "not_found" } });
    expect((await api(`/v1/patients/not-a-uuid`)).status).toBe(404);

    const { rows } = await super_.query(
      `SELECT action, patient_id, clinic_id, request_id IS NOT NULL AS has_request
         FROM app.audit_event WHERE actor_user_id = $1 ORDER BY chain_seq`,
      [userId],
    );
    expect(rows).toEqual([
      { action: "list", patient_id: null, clinic_id: null, has_request: true },
      { action: "view", patient_id: ids.mine, clinic_id: ids.clinic, has_request: true },
    ]);
    expect((await super_.query(`SELECT * FROM app.verify_audit_chain()`)).rows).toEqual([]);
  });

  it("rate-limits repeated two-factor guesses", async () => {
    const api = client(limited);
    await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await api("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: "123456" } })).status);
    }
    expect(statuses).toContain(429);
    expect(statuses).not.toContain(200);
  });

  it("keeps password hashes and TOTP secrets out of reach of the app role", async () => {
    await super_.query("BEGIN");
    await super_.query("SET LOCAL ROLE emb_app");
    await expect(super_.query(`SELECT * FROM auth."account"`)).rejects.toThrow(/permission denied/);
    await super_.query("ROLLBACK");
  });
});
