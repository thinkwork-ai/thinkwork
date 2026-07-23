---
type: feat
scope: mcpherson etl-platform (McPherson-Data/thinkwork) + small product API surface
status: implementation-ready
origin: McPherson twin pilot (2026-07-23, session 62422f88) + Eric decisions same day
---

# McPherson Dagster ELT → Neptune: Iceberg lane + per-run twin currency

## Goal Capsule

Finish the Dagster ELT → Neptune loading path for the McPherson Digital Twin so that
**every Dagster batch run leaves Neptune current**, with **Iceberg tables in the lake as
the canonical analytical store**. PostgreSQL stays for ledgers and pipeline metadata
(Eric, 2026-07-23); it stops being the analytical read surface. The extractor source is
known to be **test data** — production cutover is its own unit (U4) and everything built
here treats test data as the development fixture and is rebuilt cleanly at cutover.

Not in scope: retiring `generic_mirror`/the Postgres replica (follow-on once Athena
consumers are proven), Analyst/warehouse-MCP repointing, TEI (LastMile) pipelines.

## Ground truth this plan is built on (verified 2026-07-23)

- `generic_twin` already reads batch parquet **from the lake** (`raw/<source>/<dataset>/<batch>/`),
  joins the S3 mapping export + identity snapshot, MERGEs into Neptune, and ledgers to
  `platform.twin_batch` (warehouse Postgres). Postgres is ledger-only in the twin lane already.
- The lake is **plain parquet + Glue external tables**, not Iceberg. Batches accumulate under
  per-batch prefixes; `_latest` views mask full-snapshot duplication (masters ×2, orders ×5 at
  McPherson). Iceberg MERGE removes the duplication at the storage layer and retires the views.
- The pilot proved the full chain end-to-end (15,872 canonicals, 9 datasets, live cypher +
  dollar-accurate agent report) with two invariants that MUST carry into everything below:
  **type-prefixed external ids** (`cust:`/`ord:`/`item:`/`br:`/`co:`/`sup:` — the twin resolver
  keys on `(source, external_id)` only and JDE AN8/ITM/MCU keyspaces collide) and
  **`twin_*` dataset names** (`jde/orders` is claimed by the bespoke `jde_orders_pipeline`).
- F4211/F42119 (order lines, 1.5GB/6.6GB) sit unconverted in `mcp-jde-csv` because the bridge's
  explicit `F4211 → jde/orders` column-subset mapping always wins. Ontology v2 already models
  `order_item` + `has_item`/`for_product`.
- `platform.trigger_mapping` has no per-dataset config column → dataset semantics (natural keys,
  twin derivations) live in a code registry in the etl repo, like the bridge's table maps.

## Key Technical Decisions

- **KTD-1 — Iceberg via Athena engine v3 (`MERGE INTO`), not PyIceberg.** No new daemon deps;
  Athena is already wired (views, dbt mart). Batch is queryable at MERGE time by registering a
  temp external table over the batch prefix. PyIceberg is the contingency if Athena MERGE
  limits bite (wide tables are fine; it's row-level ops we need).
- **KTD-2 — Natural-key registry in code** (`pipelines/generic/keys.py`): per (source, dataset)
  merge keys, sourced from the JDE data dictionary (f0101=aban8, f4201=kcoo+dcto+doco(+sfxo),
  f4211=kcoo+dcto+doco+lnid, …). Datasets without an entry stay **append-only** (today's
  behavior) — zero-touch onboarding is not broken.
- **KTD-3 — Iceberg lane ships inert** behind `ICEBERG_LANE_ENABLED` (house ship-inert rule):
  new Glue db `ice_<source>` alongside `raw_<source>`; existing raw tables/views untouched
  until consumers flip.
- **KTD-4 — twin_* derivation runs IN the batch run, writing derived parquet under
  `raw/<source>/twin_*/<batch>/` in the LAKE bucket directly** (never the landing bucket —
  landing manifests re-trigger the dispatcher and would loop). `project_batch()` is then called
  in-run per derived dataset. One run = land → derive → identity-sync → project, atomically
  visible in the ledger.
- **KTD-5 — Identity sync is product-side creation, ETL-side detection.** The Dagster step only
  diffs derived externals against the identity snapshot and POSTs unknowns to a new product
  endpoint (`POST /api/tenants/{tenantId}/identity-externals:bulk-register`, admin-key auth,
  idempotent on (source_system, external_id), `created_by='backfill'` lane, resolution events
  emitted). Canonical identity machinery stays wholly in product Aurora. After registration the
  step invokes the projector (drain) + snapshot refresh so the same run's projection resolves.
- **KTD-6 — Ledgers stay in warehouse Postgres** (Eric, 2026-07-23): `platform.twin_batch`,
  `platform.mirror_batch`, `trigger_mapping` (product DB) all unchanged.
- **KTD-7 — Prod cutover = clean rebuild, not migration**: wipe pilot tenant identities +
  `clear` bulk-rebuild, fresh bootstrap from prod-fed Iceberg state, full re-deposit. Test-data
  graph is a fixture, never migrated forward.

## Implementation Units

### U1 — Iceberg raw lane + F4211 full-width conversion (etl repo)
**Goal:** batches MERGE into per-dataset Iceberg tables; order-line files convert.
**Files:** `pipelines/generic/iceberg.py` (new: DDL-if-missing, temp batch table, MERGE/append,
snapshot props stamped with batch_id), `pipelines/generic/keys.py` (new: key registry),
`pipelines/generic/pipeline.py` (generic_raw: iceberg step behind `ICEBERG_LANE_ENABLED`),
`pipelines/bridges/jde_csv/_logic.py` (add full-width `F4211 → jde/f4211`, `F42119 → jde/f42119`
as NEW dataset names — the existing `F4211 → jde/orders` subset mapping is untouched),
`tests/test_generic_iceberg.py` (new), infra: Athena workgroup/result prefix + Glue db in
`stacks/data-lake` if missing.
**Test scenarios:** MERGE upserts on key (same key twice → one row, latest wins); keyless
dataset appends; DDL idempotent + concurrent-create race tolerated; batch temp table cleaned up
on failure; F4211 full-width row lands with all columns as text; flag off → byte-identical
behavior to today.
**One-off migration:** CTAS existing deduped parquet into Iceberg per dataset (runbook step,
not code), pinning the latest `_batch_id` — this is where the ×2/×5 duplication dies.

### U2 — twin_derive in-run assets (etl repo)
**Goal:** replace the pilot's local extract.sql with Athena derivations over Iceberg state.
**Files:** `pipelines/projections/twin/derive.py` (new: per-dataset SQL registry — ports
extract.sql with prefixed ids, Julian conversion, shotot/100, batch-dedup no longer needed
post-Iceberg, `child_of` self-loop filter, `ships_to` only-when-differs, UOM columns on
cost/price), `pipelines/generic/pipeline.py` (new asset `generic_twin_derive` between raw and
twin: for source datasets that feed derivations, run the SQL, write derived parquet to
`raw/jde/twin_*/<batch>/`, then invoke `project_batch` per derived dataset), tests.
**Test scenarios:** derivation triggers only for registered inputs (f4201 batch → twin_orders +
twin_customers refresh; f4101/f4102 → twin_products/costs/prices/branches-links); derived rows
carry prefixed ids; no landing-bucket writes (loop guard); ledger rows appear per derived
dataset per batch; a source dataset with no derivation is a no-op.

### U3 — identity sync (product repo + etl repo)
**Goal:** new externals get canonicals in the same run; Neptune projection stops deferring them.
**Files (product):** `packages/api/src/handlers/identity-externals-bulk-register.ts` (new
Lambda, admin-key auth, idempotent bulk create canonicals+mappings+events, normalization per
`normalizeEntityName`), handlers.tf + build-lambdas.sh entries (house rule: both), tests.
**Files (etl):** `pipelines/projections/twin/identity_sync.py` (new: snapshot diff → POST →
projector invoke → snapshot refresh wait), wired before projection in U2's asset, tests.
**Test scenarios:** unknown externals registered once (re-POST = no dupes); display-name
fallbacks (order key when no name field); projection after sync shows matched counts == rows
(0 deferred for registered types); endpoint rejects non-admin callers; product deploy rides a
normal release (no hand `update-function-code`).

### U4 — production source cutover + clean rebuild (McPherson-side + operator)
**Goal:** real business data in the twin.
**Steps:** McPherson repoints the extractor at production JDE (their Oracle side) → fresh full
drop lands in `mcp-jde-csv` → bridge + U1 lane converts into Iceberg → operator runbook:
tenant identity wipe + `clear` bulk-rebuild → U3 registers prod externals → U2 projections
rebuild facets/edges → cohort proofs vs prod counts. Backfill scope (Jan 2024→ vs Jan 2026→)
is an Eric call at cutover; mechanics are scope-free.
**Gate:** no demo quotes real-business claims until this unit closes (current graph = test data).

## Verification Contract

- etl repo: `uv run pytest` green incl. new suites; checkov/validate CI green; PRs to
  McPherson-Data/thinkwork main.
- Live (test-data fixture): drop one f4201 batch → single Dagster run lands Iceberg, derives
  twin_orders/twin_customers, registers new externals, projects, ledgers — then a twin cypher
  count reflects the batch **with zero manual steps**.
- Product repo: standard suite + release train; endpoint smoked via admin key on mcpherson
  stage.
- Idempotency: re-dispatch same batch = explicit ledger skip everywhere (raw, derive, twin).

## Definition of Done

U1–U3 merged and live at McPherson (flag ON), single-run end-to-end proven on test data with
zero manual steps; U4 executed when McPherson delivers prod extraction, followed by clean
rebuild + cohort proof; runbook page updated (twin-install runbook gains the "continuous ELT"
section); TEI untouched.
