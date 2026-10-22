# ADR 0003 — One Session Rules module for every game

- Status: Accepted
- Date: 2026-10-22
- Design doc: §8.1

## Context

In v1 every game handled time and lives differently (Tunnel Rush never ended on hits, Peek Peek overrode lives with its own budget, Orbital Order used `countdown_timer` as seconds).

## Decision

`@emb/session-rules` is a pure, deterministic state machine that owns the clock, lives and end conditions. The therapist picks `timed`, `lives` or `timed_lives` per protocol step. Games only report events (`qualifyingInteraction`, `lifeLossEvent`, `contentExhausted`, `quit`).

- Timer starts on the first qualifying interaction, never on load; pauses are excluded from play time.
- Statuses: `completed`, `time_up`, `out_of_lives`, `abandoned`. Same-frame precedence: `out_of_lives` > `time_up` > `completed`.
- `lives = "auto"` leaves a per-board budget to the game (Peek Peek); a safety cap ends clockless sessions.
- The module never reads a clock; the host passes `now`, which makes replay tests exact.

## Consequences

Identical behaviour and HUD across games; cross-game metrics are comparable; a new SDK game gets all of this for free.
