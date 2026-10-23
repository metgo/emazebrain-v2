# eMazeBrain v2

A rebuild of eMazeBrain: a platform where pediatric therapists run multi-week protocols of game-based activities with children, in clinic and at home.

**Status: Phase 0 (Foundations).** See the design document for the full plan; `CLAUDE.md` lists the rules every change must follow.

## What's here

| Path | What it is | State |
| --- | --- | --- |
| `packages/session-rules` | The one module that owns time, lives and end conditions for every game (`timed` / `lives` / `timed_lives`) | Done, 24 tests |
| `packages/db` | Postgres migrations with row-level security per clinic, an append-only hash-chained audit log, the synthetic-data factory, and tests against a real database | Tenancy, patients, care team, consent, audit, auth schema; 19 tests |
| `packages/ui` | Design system: §7 tokens (light and dark), Inter + Rubik, buttons, fields, alerts, data list (table on desktop, cards on tablet), app shell (rail / compact rail / bottom tabs) | 10 tests, incl. a repo-wide check for physical CSS |
| `packages/game-sdk` | The typed contract between games and the host: manifest, parameters, lifecycle, events | Types only |
| `apps/api` | Hono API: Better Auth login with mandatory TOTP for staff, `/v1/me`, `/v1/patients` (optional clinic filter) under RLS with read auditing; `seed:dev` for local data | 10 tests, incl. full sign-in → MFA → patients flow |
| `apps/web` | Clinic web app (React 19 + Vite): sign-in, two-step setup and verification, Today, Patients, one patient, Settings; Hebrew and English with RTL; 15-minute idle lock | 16 unit tests + 8 end-to-end tests with axe (WCAG 2.2 AA) |
| `games/tunnel-rush-spike` | Throwaway test: can PixiJS 8 run Tunnel Rush at 60 fps on a cheap tablet? | PASS on the founder's test tablets (2026-10-22) |
| `spikes/powersync` | Self-hosted PowerSync vs RLS: same rows for every user? | PASS: 0 leaks, 0 gaps over 160 users; revocations < 1 s |
| `spikes/capacitor-offline` | Sandboxed game loads its pack offline | PASS in Chromium (9/9) and in the tablet browser; installed-app run later |
| `docs/adr` | Architecture decision records | 5 ADRs |

## Getting started

```bash
pnpm install
pnpm test
pnpm typecheck
```

The database tests need a Postgres superuser connection; each run creates and drops its own database:

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/db test
```

Run the clinic app locally (synthetic data only):

```bash
export DATABASE_URL=postgres://postgres@localhost:5432/emb_dev AUTH_SECRET=$(openssl rand -hex 32)
pnpm --filter @emb/api seed:dev                                   # prints the therapist's email and password
TRUSTED_ORIGINS=http://localhost:5173 pnpm --filter @emb/api dev  # API on :8787
pnpm --filter @emb/web dev                                        # app on http://localhost:5173
```

The first sign-in asks you to set up an authenticator app. End-to-end tests start their own API and database:

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/web e2e
```

`pnpm --filter @emb/web build:demo` builds a click-through demo with an in-browser fake API and synthetic data (no server needed).

## Phase 0 checklist (design doc §15)

- [x] Monorepo (pnpm + Turborepo), TypeScript strict
- [x] `session-rules` with tests
- [x] RLS schema for tenancy and patients, with a test that every table forces RLS
- [x] Game SDK types
- [x] CI pipeline
- [x] Tunnel Rush spike passed on the founder's test tablets
- [x] PowerSync spike: synced rows equal RLS rows (0 leaks, 0 gaps; revocations < 1 s)
- [x] Capacitor spike: sandboxed game loads its packs offline (Chromium and tablet browser PASS; installed-app run later)
- [x] Better Auth with mandatory staff MFA (TOTP)
- [x] Audit log: trigger-logged writes, API-logged reads, hash chain
- [ ] SST infrastructure for the Israel cell
- [x] Design tokens and app shell (`packages/ui`, `apps/web`), Hebrew and English, RTL
