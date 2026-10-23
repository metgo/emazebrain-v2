/**
 * Demo build only (vite --mode demo): answers /api/auth/* and /v1/* in the
 * browser with synthetic data, so the clinic app can be clicked through on a
 * tablet without a server. It imitates the real API's responses closely
 * enough for the UI; it is not a security boundary and holds no real data.
 *
 * Demo rules: any email and a password of 12+ characters sign in; any six
 * digits other than 000000 pass as a code.
 */
import { syntheticPatients } from "@emb/db/synthetic";

const KEY = "emb.demo.state";
type State = { email: string | null; name: string; mfa: boolean; stage: "out" | "pending_2fa" | "in" };

function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fresh state */
  }
  return { email: null, name: "Yael Bar", mfa: false, stage: "out" };
}
function save(s: State) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* in-memory only */
  }
}

const clinicA = "0192f3a0-0000-7000-8000-00000000c11a";
const clinicB = "0192f3a0-0000-7000-8000-00000000c11b";
const patients = [
  ...syntheticPatients(14, { seed: 7, locale: "mixed" }).map((p, i) => ({ ...p, clinic_id: clinicA, id: `0192f3a0-0000-7000-8000-${String(i).padStart(12, "0")}` })),
  ...syntheticPatients(4, { seed: 99, locale: "he" }).map((p, i) => ({ ...p, clinic_id: clinicB, id: `0192f3a0-0000-7000-8000-${String(100 + i).padStart(12, "0")}` })),
].sort((a, b) => a.family_name.localeCompare(b.family_name) || a.given_name.localeCompare(b.given_name));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": crypto.randomUUID() } });

const delay = () => new Promise((r) => setTimeout(r, 250 + Math.random() * 250));

function user(s: State) {
  return { id: "0192f3a0-0000-7000-8000-0000000000a1", email: s.email, name: s.name, emailVerified: true, twoFactorEnabled: s.mfa, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), image: null };
}

async function handle(path: string, method: string, body: Record<string, unknown>): Promise<Response> {
  const s = load();
  await delay();

  // ---- auth
  if (path === "/api/auth/get-session") {
    return json(s.stage === "in" ? { session: { id: "demo", userId: user(s).id, expiresAt: new Date(Date.now() + 36e5).toISOString() }, user: user(s) } : null);
  }
  if (path === "/api/auth/sign-in/email" && method === "POST") {
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    if (!email.includes("@") || password.length < 12) return json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
    const local = email.split("@")[0] ?? "demo";
    const name = local.charAt(0).toUpperCase() + local.slice(1);
    const next: State = { ...s, email, name: name.length > 1 ? `${name} Bar` : "Yael Bar", stage: s.mfa ? "pending_2fa" : "in" };
    save(next);
    return s.mfa ? json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] }) : json({ redirect: false, token: "demo", user: user(next) });
  }
  if (path === "/api/auth/sign-out") {
    save({ ...s, stage: "out" });
    return json({ success: true });
  }
  if (path === "/api/auth/two-factor/enable") {
    if (String(body.password ?? "").length < 12) return json({ code: "INVALID_PASSWORD", message: "Invalid password" }, 400);
    return json({
      totpURI: `otpauth://totp/eMazeBrain:${encodeURIComponent(s.email ?? "demo")}?secret=JBSWY3DPEHPK3PXPDEMOKEY2&issuer=eMazeBrain&digits=6&period=30`,
      backupCodes: ["7KQ2M-XW9PD", "R4T8N-HB2LC", "Z6YV3-QF7KM", "P9D2W-JN5XR", "C3HL8-TM6QV", "W5BX9-KD2PF", "N8RJ4-VC7HZ", "F2MQ6-LX9TB", "H7PK3-ZW4NR", "Q4VD8-BM2JC"],
    });
  }
  if (path === "/api/auth/two-factor/verify-totp" || path === "/api/auth/two-factor/verify-backup-code") {
    const code = String(body.code ?? "");
    const ok = path.endsWith("totp") ? /^\d{6}$/.test(code) && code !== "000000" : code.length >= 6;
    if (!ok) return json({ code: "INVALID_CODE", message: "Invalid code" }, 401);
    save({ ...s, mfa: true, stage: "in" });
    return json({ token: "demo", user: user({ ...s, mfa: true }) });
  }

  // ---- v1 (same rules as requireStaffSession)
  if (path.startsWith("/v1/")) {
    if (s.stage !== "in") return json({ error: "unauthenticated" }, 401);
    if (!s.mfa) return json({ error: "mfa_required" }, 403);
  }
  if (path === "/v1/me") {
    return json({
      user: { id: user(s).id, email: s.email, name: s.name },
      memberships: [
        { clinic_id: clinicA, organization_id: "org", role: "therapist", clinic_name: "Tel Aviv Child Development Center" },
        { clinic_id: clinicB, organization_id: "org", role: "therapist", clinic_name: "Haifa North Clinic" },
      ],
    });
  }
  if (path === "/v1/patients") {
    return json({ patients: patients.map(({ preferred_locale: _l, ...p }) => p) });
  }
  const m = /^\/v1\/patients\/([^/]+)$/.exec(path);
  if (m) {
    const p = patients.find((x) => x.id === m[1]);
    return p ? json({ patient: p }) : json({ error: "not_found" }, 404);
  }
  return json({ error: "not_found" }, 404);
}

export function installDemoApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(typeof input === "string" ? new URL(input, location.href) : input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin || !(url.pathname.includes("/api/auth/") || url.pathname.includes("/v1/"))) return real(input, init);
    const path = url.pathname.slice(url.pathname.search(/\/(api\/auth|v1)\//));
    let body: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
    }
    const clinic = url.searchParams.get("clinic");
    const res = await handle(path, req.method, body);
    if (path === "/v1/patients" && clinic && res.ok) {
      const data = (await res.json()) as { patients: Array<{ clinic_id: string }> };
      return json({ patients: data.patients.filter((p) => p.clinic_id === clinic) });
    }
    return res;
  };
}
