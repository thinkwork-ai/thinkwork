# Stage migration log — prod + customer stages (THINK-220 Phase 6)

Every stage running Hindsight repeats the cutover after dev proves out:
**dev → prod → TEI → McPherson** (prod validates the runbook on a
non-customer stage before any customer window).
This file is the running log — update the checklists as steps complete, and
add a row for any new stage that ships before the migration is automated in
the deploy runner.

Ordering rule: **dev soaks first** (Phase 5, ≥1 week with the maintenance
loop verified live), then customer stages. Customer runs use the same kit
(README.md in this directory) with these stage-specific deltas:

- The deploy runner, not a hand session, must own steps 3–6 for customer
  stages (`control_plane=false` stages self-update; see the runner ledger
  doc) — hand-run is acceptable only if Eric explicitly opts to drive one.
- `terraform.tfvars` for the stage sets `hindsight_database_name` — confirm
  who owns that file per stage before the window.
- Retain pause window: customer-visible. Schedule with the customer for
  TEI/McPherson; their agents' retains fail loud during the window.

## Stage: dev (control plane)

- [x] `thinkwork_hindsight` database created with pgvector (2026-07-07,
      bootstrap SQL)
- [x] Phase 1 seam deployed (#3491)
- [x] Phase 2 terraform merged (#3493)
- [x] Rehearsal passed on a data copy (2026-07-07)
- [x] Cross-schema blockers reshaped (#3498; array-param hotfix #3506 —
      drizzle arrays render as records, use ARRAY[...] with sql.join)
- [x] Cutover executed (Phase 4, 2026-07-07 ~19:40Z): MIGRATION_OK
      17,574 units; flip deploy via HINDSIGHT_DATABASE_NAME repo variable +
      workflow_dispatch. Window loss: 14 units retained 19:21-19:40Z remain
      in the old schema only.
- [x] Maintenance loop verified live (revision 16, 19:50Z+): reconcile /
      retention / mental-model refresh all clean; retains land in the new
      database with nonzero extractedUnitCount (Phase 5 soak clock started)
- [ ] ≥1 week soak, then old `hindsight` schema dropped (explicit approval)

## Stage: prod

- [ ] Confirm Hindsight enabled + image tag matches dev's at cutover time
- [ ] `thinkwork_hindsight` database created with pgvector (bootstrap SQL)
- [ ] `hindsight_database_name` set in prod tfvars
- [ ] Retain pause window (internal — no customer coordination, but pick a
      quiet hour)
- [ ] Cutover executed (hand-run acceptable here; doubles as the runner
      automation shakeout)
- [ ] Maintenance loop verified in `/thinkwork/prod/hindsight` logs
- [ ] Soak + old-schema drop (approval)

## Stage: TEI

- [ ] Confirm Hindsight enabled + image tag matches dev's at cutover time
- [ ] Runner automation for: create DB + pgvector, dump/restore, move
      objects to public, install maintenance-functions.sql
- [ ] `hindsight_database_name` set in stage tfvars
- [ ] Retain pause window scheduled with customer
- [ ] Cutover executed via runner
- [ ] Maintenance loop verified in stage logs
- [ ] Soak + old-schema drop (approval)

## Stage: McPherson

- [ ] Confirm Hindsight enabled + image tag matches dev's at cutover time
      (watch the known stale-Pi-image gotcha — ghcr private image — while
      verifying stage versions)
- [ ] Runner automation (same items as TEI; build once, run per stage)
- [ ] `hindsight_database_name` set in stage tfvars
- [ ] Retain pause window scheduled with customer
- [ ] Cutover executed via runner
- [ ] Maintenance loop verified in stage logs
- [ ] Soak + old-schema drop (approval)

## Fresh stages (no existing Hindsight data)

No dump/restore: provision the database empty (pgvector + vanilla boot runs
all migrations, including the repair migration that installs the discovery
functions — maintenance-functions.sql is NOT needed), set
`hindsight_database_name` from day one. The greenfield path should default
to the dedicated database once dev soaks clean.
