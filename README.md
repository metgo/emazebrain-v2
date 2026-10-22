# eMazeBrain v2

A rebuild of eMazeBrain: a platform where pediatric therapists run multi-week protocols of game-based activities with children, in clinic and at home.

**Status: Phase 0 (Foundations).** See the design document for the full plan; `CLAUDE.md` lists the rules every change must follow.

## What's here

| Path | What it is | State |
| --- | --- | --- |
| `packages/session-rules` | The one module that owns time, lives and end conditions for every game (`timed` / `lives` / `timed_lives`) | Done, 24 tests |
| `packages/db` | Postgres migrations with row-level security per clinic, and isolation tests against a real database | Core tenancy, patients, care team, consent; 12 tests |
| `packages/game-sdk` | The typed contract between games and the host: manifest, parameters, lifecycle, events | Types only |
| `apps/api` | Hono API service | Health endpoint + request ids |
| `games/tunnel-rush-spike` | Throwaway test: can PixiJS 8 run Tunnel Rush at 60 fps on a cheap tablet? | Ready to run on a device |
| `docs/adr` | Architecture decision records | 3 ADRs |

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

## Phase 0 checklist (design doc §15)

- [x] Monorepo (pnpm + Turborepo), TypeScript strict
- [x] `session-rules` with tests
- [x] RLS schema for tenancy and patients, with a test that every table forces RLS
- [x] Game SDK types
- [x] CI pipeline
- [ ] Tunnel Rush spike measured on a Galaxy Tab A9 and an iPad 9th gen
- [ ] PowerSync spike: synced rows equal RLS rows
- [ ] Capacitor spike: sandboxed game loads its packs offline
- [ ] Better Auth with MFA
- [ ] Audit log
- [ ] SST infrastructure for the Israel cell
- [ ] Design tokens and app shell (`packages/ui`, `apps/web`)
