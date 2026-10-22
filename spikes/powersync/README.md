# Spike: self-hosted PowerSync vs Postgres RLS

**Question (design doc §9.8, §16):** PowerSync replicates from the write-ahead log, which bypasses row-level security. Can its sync rules give every device exactly the patients RLS allows — no leaks, no gaps — and do revocations reach devices fast enough?

**Answer: yes. PASS.**

## Result (2026-10-22)

PowerSync Service 1.27.1 (Open Edition), built from source, self-hosted, with **Postgres bucket storage** (no MongoDB), replicating a Postgres 16 database seeded by `seed.ts`.

| Check | Result |
| --- | --- |
| Users compared | 160 (8 org-wide admins, 12 managers, 116 therapists incl. 27 in two clinics, 14 assistants, 10 with no membership) |
| Allowed patient rows compared | 2,656 |
| Leaks (synced but RLS forbids) | **0** |
| Gaps (RLS allows but not synced) | **0** |
| Drift cases covered | 11 revoked memberships, 37 care-team rows pointing at non-members, ended care-team rows, 5% archived patients |
| Membership revoked → device consistent | 715 ms (restore 616 ms) |
| Removed from care team → device consistent | 764 ms (restore 652 ms) |
| Patient archived → device consistent | 718 ms (restore 640 ms) |

Target was ≤ 60 s for revocations; measured under 1 s on one machine.

## What the test caught

The first version of the rules had **no stream for organization-wide admins** (membership with `clinic_id IS NULL`). The comparison flagged all 8 of them with 1,528 missing rows. A third stream with a join to `clinic` fixed it. That's exactly why this check belongs in CI: rules written by hand drift from RLS, and only an automated comparison notices.

A second finding: aliasing the synced table (`FROM app.patient AS p`) makes rows sync under the name `p`, so clients see an empty `patient` table. PowerSync warns about it in the log; the rule now uses the unaliased name.

## Notes for production

- Sync Streams (edition 3) support `IN (SELECT …)` subqueries and joins, so the rules can mirror `app.can_see_patient()` directly. `IN ('a', 'b')` literal lists are not supported; use `OR`.
- Requires `wal_level = logical` and a publication named `powersync`.
- The service needs Node 24 (it uses `await using`).
- Bucket storage in Postgres works, so a cell needs no MongoDB. Use a separate database (here `emb_ps_storage`) on the same RDS instance.
- Auth here is a local HS256 key. Production uses Ed25519 (OKP) keys issued by the API, which PowerSync supports.
- Consent is not part of `can_see_patient()` today; when it is, add the same condition to the streams and rerun the comparison.

## Run it

```bash
# Postgres with wal_level=logical, then:
ADMIN_URL=postgres://postgres:<pw>@localhost:5432/postgres pnpm seed
# start PowerSync with powersync.yaml (PS_SOURCE_URI, PS_STORAGE_URI, PS_HS256_KEY set)
PS_HS256_KEY=<key> ADMIN_URL=... pnpm compare      # exits 1 on any leak or gap
PS_HS256_KEY=<key> ADMIN_URL=... pnpm revocation
```

**Next step:** turn `compare.ts` into a CI job (Postgres + PowerSync containers) with 1,000 synthetic users, as the design doc requires.
