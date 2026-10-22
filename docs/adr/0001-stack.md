# ADR 0001 — Own TypeScript stack on AWS, not Base44

- Status: Proposed (pending founder confirmation and the three Phase 0 spikes)
- Date: 2026-10-22
- Design doc: §9

## Context

v1 runs on Base44, which owns the database and server code. v2 needs Israeli, US and EU data residency, HIPAA/COPPA/GDPR/Amendment 13 controls, offline-first tablets and store apps, built by one developer with AI tools.

## Decision

- TypeScript end to end in one pnpm + Turborepo monorepo.
- React 19 SPA, shipped as web and as two Capacitor store apps (Clinic, Home).
- PixiJS 8 for games; three.js allowed per game if the Tunnel Rush spike fails.
- Hono on Node 22 for the API; REST `/v1` with OpenAPI from Zod.
- PostgreSQL 17 on Amazon RDS with row-level security per clinic; Drizzle + raw SQL migrations.
- Self-hosted PowerSync for offline sync; pg-boss for jobs.
- Better Auth, self-hosted, so identities stay in-region with no auth vendor BAA.
- AWS, one regional cell per residency zone: `il-central-1` first.

## Consequences

- No vendor holds patient data outside our cells except where a BAA/DPA is signed.
- More operations work than a BaaS; mitigated by SST IaC and managed services.
- Revisit if any spike fails: Tunnel Rush frame rate, PowerSync/RLS equivalence, Capacitor offline game loading.
