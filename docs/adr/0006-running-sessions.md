# 0006 — Running sessions and saving results once

Status: accepted (slice 4)

## Context

A therapist starts a planned session, hands the tablet to a child, and the
games' results must reach the record exactly once (design doc §5.6, §8.2,
§9.8; CLAUDE.md invariants 4, 5 and 8). Clinic Wi-Fi drops, tabs get closed,
and a child will tap anything that looks like a button.

## Decision

- **The server builds every game's parameters** at launch
  (`POST /v1/planned-sessions/:id/launch`): platform settings from the
  patient's step (difficulty, mode, hemisphere, practice "auto" → on only for
  a step's first session), the patient's language and colour-vision setting,
  and the game's own settings namespaced by game id. Consent and care-team
  membership are checked again here, not only in the UI.
- **Launch tickets.** Each game gets an Ed25519-signed ticket (24 h) naming the
  planned session, step, patient, game, staff user and the SHA-256 of the
  canonical params. `POST /v1/results` refuses an envelope whose ticket is
  forged or expired, whose game differs, whose params hash differs, or that is
  a demo. Production must set `LAUNCH_SIGNING_KEY` (PKCS#8 PEM); without it a
  throwaway key is generated, which is fine for dev and tests only.
- **Every upload attempt is kept** in `session_result_raw` (append-only, insert
  only, unreadable by the app role), accepted or not, with the reason.
- **Idempotency.** `game_session.id` is the device's UUIDv7 session id.
  `INSERT … ON CONFLICT DO NOTHING`; a repeat returns `duplicate` with 200.
- **Progression** runs in the same transaction through the pure
  `@emb/progression` package; only valid, non-abandoned sessions at the
  current difficulty count. Every decision with a rule is logged in
  `progression_decision` with the accuracies used.
- **The planned session closes** when every step has a result for it; a
  session ended early stays `in_progress` and can be picked up later (launch
  marks steps already played as `done`).
- **Device outbox.** The app writes each envelope and its ticket to
  `localStorage` before sending, and removes it only after the server stored
  it, or stored and explained a rejection (400/422). 403, 5xx and network
  errors keep it; it is retried on sign-in, when the browser comes online,
  and every minute. The outbox holds ids, settings and scores — no names.
- **Kid mode.** Therapist controls (skip, end, see results) sit behind a
  long press on a corner lock and a per-device PIN, stored as a salted
  SHA-256 hash in the browser; five wrong tries lock it for a minute. A
  4–6 digit PIN on a shared tablet is a speed bump against a child, not an
  authentication factor: the staff session and its idle lock still apply.
  Game heartbeats count as activity so the idle lock doesn't fire mid-game.

## Consequences

- A result can't be attached to another patient or claim settings it wasn't
  played with, even by a modified client.
- Rotating `LAUNCH_SIGNING_KEY` invalidates tickets for sessions in flight;
  the outbox keeps those results and the rejection is visible in the raw log.
  A key ring with `kid` lookup comes before production.
- Results recorded on a device whose user later loses access stay in the
  outbox until someone with access signs in there; a support view of stuck
  items is future work.
