# ADR 0002 — Clinic isolation with Postgres row-level security

- Status: Accepted
- Date: 2026-10-22
- Design doc: §6, §10.1

## Decision

One shared schema; every tenant row carries its clinic (directly or through the patient). Isolation is enforced in the database:

- The app connects as `emb_app` (`NOBYPASSRLS`) and sets `app.user_id` with `SET LOCAL` in every transaction.
- Every table in schema `app` has `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Policy helpers `app.has_clinic_role()` and `app.can_see_patient()` are `SECURITY DEFINER`, owned by a dedicated `NOLOGIN BYPASSRLS` role (`emb_rls_helper`) so policies never recurse.
- A therapist sees only patients on their care team; a clinic manager sees the whole clinic; nobody sees another clinic.
- Consent records are append-only via trigger, which also binds superusers.

## Verification

`packages/db/test/rls.test.ts` runs against a real Postgres in CI and fails if any table in `app` lacks forced RLS.

## Open

- Confirm Amazon RDS allows creating a `NOLOGIN BYPASSRLS` role as `rds_superuser`. If not, the helpers move to a schema owned by a role exempted via policy, or to security-barrier views.
