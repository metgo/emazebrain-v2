/**
 * Better Auth client (ADR 0004). Same origin as the SPA: in development the
 * Vite proxy forwards /api to the API; in production the cell's API serves the
 * app's origin through the CDN.
 */
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost",
  plugins: [twoFactorClient()],
  // Resolve fetch on every call (not once at start-up), so the demo build's
  // in-browser API and test doubles see auth requests too.
  fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
});

export type AuthFailure = "invalid" | "rate_limited" | "expired" | "network" | "unknown";

/** Turns a Better Auth error into one of the few things we tell the user. */
export function authFailure(error: { status?: number; code?: string | undefined } | null | undefined): AuthFailure {
  if (!error) return "unknown";
  if (error.status === 429) return "rate_limited";
  if (!error.status) return "network";
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return "expired";
  if (error.status === 401 || error.status === 400 || error.status === 403) return "invalid";
  return "unknown";
}
