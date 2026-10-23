# ADR 0007 — Progress view: trends against the child's own baseline

- Status: Accepted
- Date: 2026-10-23
- Design doc: §5.9 (telemetry and reports), §11.6 (wording guardrails)

## Decisions

- **Baseline per game × difficulty.** The baseline is the mean of a child's first two sessions of a game at a given difficulty (§5.9 assumption). When difficulty changes, a new baseline starts, so harder work never reads as a decline.
- **One scale for every view: 100 = baseline, higher is better.** Lower-is-better metrics (response time, smallest colour difference) are inverted (`baseline / value`). A skill view averages the scores of every metric a game's manifest tags with that skill, each against its own baseline, so skills stay comparable across games without new code per game.
- **The maths is a pure package, `@emb/metrics`.** No clock or I/O, fully unit-tested, and it runs on the client. The same code will serve offline devices and PDF reports later.
- **Plain-language summary.** It needs at least three scored sessions and one after the baseline. It averages the latest three post-baseline sessions: ≥ 110 "above baseline", ≤ 90 "below baseline", otherwise "near baseline". Chips use brand or neutral colours, never red or green, and nothing says "at risk", "below age level", or compares with other children (§11.6). Age norms stay off.
- **Chart.** A single series (2 px line, 8 px markers with a surface ring; hollow markers set the baseline), a baseline reference line, a difficulty lane under the plot, an end label, and a crosshair tooltip. Arrow keys, Home and End move between sessions and announce each one; hover does not, so screen readers aren't flooded. A "Show as table" toggle shows the same numbers. Colours: `--chart-1` #5B4BDB on light, #8F80F7 on dark, both checked with the palette validator. The plot reads left to right in every language. **[Open]** confirm with Hebrew and Arabic users (§7.8).
- **API.** `GET /v1/patients/:id/progression` lists automatic difficulty changes (holds left out), with the same visibility rules and read auditing as session results.
- **Demo data.** `seed:dev` adds one synthetic patient with a finished six-week protocol and 12 sessions, so the view and its end-to-end test have a real trend.

## Open

- Whether the baseline should be two sessions, three, or a time window. Revisit with the clinical advisor once real pilot data exists.
- Invalidated sessions (`is_valid = false`) are already excluded; the screen to mark a session invalid comes with session review.
