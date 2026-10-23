# eMazeBrain v2

A rebuild of eMazeBrain: a platform where pediatric therapists run multi-week protocols of game-based activities with children, in clinic and at home.

**Status: MVP, core loop working** — patient → protocol → session → progress. See the design document for the full plan; `CLAUDE.md` lists the rules every change must follow.

## What's here

| Path | What it is |
| --- | --- |
| `apps/web` | Clinic web app (React 19 + Vite), Hebrew and English with RTL. Sign-in with two-step codes; Today; patients, guardians and consent; protocol templates, builder and assignment; running a session in kid mode; the Progress tab; team; settings |
| `apps/api` | Hono API under Postgres row-level security, with read auditing. Better Auth with mandatory single-use TOTP; patients, consent, protocols, signed launch tickets, idempotent result upload, progression; `seed:dev` for synthetic data |
| `packages/db` | Migrations (RLS on every table, append-only consent and audit, hash-chained audit log) and the synthetic-data factory |
| `packages/ui` | Design system: tokens (light and dark), components, app shell; a repo-wide check for physical CSS |
| `packages/session-rules` | The one module that owns time, lives and end conditions for every game |
| `packages/progression` | Rule-based difficulty changes, pure |
| `packages/metrics` | Progress maths: baselines per game × difficulty, scores, skill trends, summaries, pure |
| `packages/game-sdk`, `packages/game-runtime` | The game contract and the sandboxed runtime |
| `packages/contracts` | Request and response types shared by the API and the app |
| `games/catch-me-if-you-can` | The first game rebuilt on the SDK, with warm and cold palettes |
| `spikes/*`, `games/tunnel-rush-spike` | Phase 0 technical tests (all passed) |
| `docs/adr` | Architecture decision records 0001–0007 |

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
TRUSTED_ORIGINS=http://localhost:5173 pnpm --filter @emb/api dev  # API on :8787 (set LAUNCH_SIGNING_KEY in production, ADR 0006)
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

## MVP core loop (design doc §15, Phase 1)

- [x] Two-step sign-in codes are single-use
- [x] Slice 1: patients, guardians and consent; no session without consent
- [x] Slice 2: Catch Me If You Can runs inside the app, warm and cold, with a Library preview
- [x] Slice 3: protocol templates, builder generated from the game's manifest, assignment, Today
- [x] Slice 4: running a session in kid mode; each result saved exactly once; progression
- [x] Slice 5: Progress tab — trend against the child's own baseline, skill views, table view, difficulty changes, history
- [ ] Offline sync on clinic tablets (PowerSync, already spiked)
- [ ] Parent portal and home programs
- [ ] The other six games
