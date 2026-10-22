# ADR 0001 — Own TypeScript stack on AWS, not Base44

- Status: Accepted (2026-10-22, after all three Phase 0 spikes passed)
- Date: 2026-10-22
- Design doc: §9

## Context

v1 runs on Base44, which owns the database and server code. v2 needs Israeli, US and EU data residency, HIPAA/COPPA/GDPR/Amendment 13 controls, offline-first tablets and store apps, built by one developer with AI tools.

## Decision

- TypeScript end to end in one pnpm + Turborepo monorepo.
- React 19 SPA, shipped as web and as two Capacitor store apps (Clinic, Home).
- PixiJS 8 for all games, Tunnel Rush included (frame-rate spike passed on test tablets); three.js stays allowed per game through the SDK.
- Hono on Node 22 for the API; REST `/v1` with OpenAPI from Zod.
- PostgreSQL 17 on Amazon RDS with row-level security per clinic; Drizzle + raw SQL migrations.
- Self-hosted PowerSync for offline sync; pg-boss for jobs.
- Better Auth, self-hosted, so identities stay in-region with no auth vendor BAA.
- AWS, one regional cell per residency zone: `il-central-1` first.

## Consequences

- No vendor holds patient data outside our cells except where a BAA/DPA is signed.
- More operations work than a BaaS; mitigated by SST IaC and managed services.
- Spike results: Tunnel Rush PASS on test tablets; PowerSync 0 leaks / 0 gaps across 160 users with revocations < 1 s; sandboxed game loads its pack offline (9/9 checks). Remaining device check: an installed Android build restarted while offline.
