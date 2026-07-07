# Hindsight dedicated-database migration rehearsal — PASSED (THINK-220 Phase 3)

**Date:** 2026-07-07
**Plan:** docs/plans/2026-07-07-004-feat-hindsight-dedicated-database-plan.md
**Cutover kit:** scripts/hindsight-cutover/

## Setup

Fresh `pg_dump -n hindsight` of live dev (50MB, 17,539 memory_units, 21
tables + 1 matview, 0 functions/sequences/views) restored into a local
pgvector/pg16 container database named `thinkwork_hindsight`, objects moved
to `public`, then `ghcr.io/vectorize-io/hindsight:0.8.4` booted with vanilla
env (no `HINDSIGHT_API_DATABASE_SCHEMA`). A second, empty-database container
served as the vanilla reference.

## Acceptance result

One maintenance cycle after the fix-up steps below:

```
Maintenance: retention took 0.003s
Consolidation reconcile: scheduled 2 bank(s)
Maintenance: scheduled mental model refresh took 0.001s
```

No `does not exist` warnings; both discovered banks consolidated to
completion (`[CONSOLIDATION] bank=space_… completed`), one creating a new
observation via a real LLM batch. This is the loop that has never run on
dev — discovery found and processed idle-bank work on a copy of real data.

## Findings (each is a required cutover step)

1. **Schema rename collides with the extension.** `ALTER SCHEMA hindsight
   RENAME TO public` fails/misbehaves because `public` already exists holding
   the vector extension (and the extension cannot be dropped without
   cascading into vector columns). Recipe: `ALTER TABLE … SET SCHEMA public`
   for every table + `ALTER MATERIALIZED VIEW …` for the matview, then drop
   the empty source schema. By-OID dependencies make this safe.
2. **The discovery functions are missing from any migrated copy.** Upstream
   creates `banks_needing_consolidation()`, `mental_models_with_cron()`, and
   `schemas_with_expired_rows()` in an alembic *repair* migration that runs
   only on base-schema (`public`) installs. Dev never got them (schema was
   `hindsight`), and the restored `alembic_version` is at head so booting
   with schema=public does not re-fire it. Without them: retention sweep and
   mental-model discovery warn every cycle even on the dedicated database —
   only consolidation reconcile (plain SQL, not a function) works. Fix:
   `scripts/hindsight-cutover/maintenance-functions.sql`, extracted verbatim
   from the vanilla reference install. Re-extract on image bumps.
3. **`SET transaction_timeout` restore error is version skew only** (dev's
   newer Aurora emits it; pg16 lacks the GUC). Ignorable, and absent
   entirely for the real cluster-internal cutover.
4. **Consolidation reconcile discovery works without the functions** — it
   found the pending dev-data consolidation immediately on boot. The
   function-backed routines (retention, mental-model cron) are the ones that
   need finding no. 2.

## Status after rehearsal

- Phase 3 complete. Phase 4 (dev cutover) additionally gated on reshaping
  the two `CUTOVER BLOCKER (THINK-220)` cross-schema statements
  (`inspectTenant`, `enumerateDreamBanks`) shipped flagged in #3491.
- `thinkwork_hindsight` already exists on the dev cluster with pgvector
  (bootstrap SQL, 2026-07-07) — created ahead of Phase 2's terraform merge.
