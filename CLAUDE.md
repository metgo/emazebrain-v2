# eMazeBrain v2 — rules for AI coding sessions

Source of truth for product and architecture: the **eMazeBrain v2 Product & Technical Design Document** (Claude Docs). Section numbers below (§) refer to it. If code and the doc disagree, stop and ask; don't silently pick one.

## Invariants — never break these

1. **No real patient data outside production.** Not in prompts, fixtures, logs, screenshots or this repo. Use the synthetic-data factory only.
2. **Row-level security on every tenant table.** Every new table in schema `app` gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and policies in the same migration. `packages/db/test/rls.test.ts` fails otherwise. The app connects as `emb_app`, which never has `BYPASSRLS`.
3. **Every request sets `app.user_id` with `SET LOCAL`** inside its transaction. Never pass clinic ids from the client into queries as an authorisation shortcut.
4. **Append-only clinical records.** `consent`, `therapy_log`, `therapy_log_amendment`, `audit_event`, `session_result_raw` are never updated or deleted by the app; triggers enforce it.
5. **Session Rules own time and lives.** Games never run their own timer or life counter. They report events to `@emb/session-rules` (§8.1). Timer starts on the first qualifying interaction, never on load.
6. **Games import only `@emb/game-sdk`.** No network access from games; the host does all I/O (§8.3).
7. **No patient data in notifications, logs, analytics or error reports.** Push/SMS/email text is generic ("You have a new message").
8. **Idempotent result ingest.** The device-generated UUIDv7 `session_id` is the idempotency key (§9.8). Never drop a result silently.
9. **Wording.** Games are "game-based activities", never "assessment", "treatment" or "diagnosis" (§11.6).
10. **RTL and i18n from day one.** CSS logical properties only (`margin-inline-start`), ICU messages, no hard-coded UI strings. The game timer side is physical and is not mirrored.

## How to work

- One vertical slice at a time: migration → API module → UI → tests.
- AI-written migrations need a human-reviewed diff and must pass the RLS tests before merge.
- Expand/contract migrations only; never a destructive change in one step.
- Keep packages pure where possible (`session-rules`, `progression`, `metrics`): no clock, no I/O, deterministic, fully unit-tested.
- Record significant decisions as ADRs in `docs/adr/NNNN-title.md`.

## Commands

```bash
pnpm install
pnpm test          # all packages (db tests need DATABASE_URL)
pnpm typecheck
DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/db test
pnpm --filter @emb/api dev
pnpm --filter @emb/tunnel-rush-spike dev
```
