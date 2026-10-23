/**
 * Authentication (design doc §9.3, §9.9, §11.2): Better Auth, self-hosted, so
 * identities stay in the region's own Postgres and no auth vendor needs a BAA.
 *
 * - Email + password (min 12 chars) for now; passkeys and Google/Microsoft
 *   OIDC come later through Better Auth plugins.
 * - TOTP two-factor. Staff cannot reach any /v1 route until it is enabled
 *   (requireStaffSession in context.ts).
 * - Auth tables live in schema `auth`, which the app role cannot read.
 * - Every auth user gets a matching app.app_user row with the same UUIDv7 id,
 *   which is what RLS sees as app.user_id.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";
import { uuidv7 } from "./ids.ts";

export interface AuthConfig {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  /** Defaults to on. Tests switch it off to run many sign-ins in a few seconds. */
  rateLimit?: boolean;
  /** Connection pool for the auth schema; created from databaseUrl when omitted. */
  pool?: pg.Pool;
  /**
   * Headers that carry the client IP, set by the load balancer in front of the
   * API (never trust these when the API is reachable directly). Without one,
   * every client shares a single rate-limit bucket and one clinic could lock
   * out everyone.
   */
  ipAddressHeaders?: string[];
}

export function authPool(databaseUrl: string): pg.Pool {
  // Better Auth's own tables resolve to schema `auth`.
  return new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=auth", max: 5 });
}

export function createAuth(config: AuthConfig, servicePool: pg.Pool) {
  return betterAuth({
    appName: "eMazeBrain",
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins ?? [config.baseURL],
    database: config.pool ?? authPool(config.databaseUrl),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12, // 12 h ceiling; web idle lock (15 min) is enforced by the client
      updateAge: 60 * 15,
    },
    rateLimit: { enabled: config.rateLimit ?? true, window: 15 * 60, max: 100 },
    plugins: [twoFactor({ issuer: "eMazeBrain" })],
    advanced: {
      database: { generateId: () => uuidv7() },
      cookiePrefix: "emb",
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders ?? ["x-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          // Mirror every new identity into app.app_user (service connection; RLS doesn't apply).
          after: async (user) => {
            await servicePool.query(
              `INSERT INTO app.app_user (id, email, full_name, kind, status)
               VALUES ($1, $2, $3, 'staff', 'active') ON CONFLICT (id) DO NOTHING`,
              [user.id, user.email, user.name],
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
