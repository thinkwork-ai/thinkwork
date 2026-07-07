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

## Stage: prod — BLOCKED on deploy-path decision

Reality check (2026-07-07): prod is EMPTY (0 tenants, 0 memory units,
Hindsight 0.5.0 task-def rev 1, never used) and is NOT
controller-provisioned — a controller `update` run found no state, planned
a greenfield stack, and was safely refused by the compliance-audit-bucket
precondition (prod requires COMPLIANCE object-lock mode). Nothing was
applied. Before prod can cut over, decide: adopt prod into the controller
(state import) or run its original deploy path. Zero urgency — the stage
serves no traffic and nothing is degraded.

- [ ] Decide prod deploy path (controller adoption vs. original path)
- [ ] `thinkwork_hindsight` database created with pgvector (DONE 2026-07-07,
      bootstrap SQL — ready whenever the deploy path is settled)
- [ ] Cutover + maintenance-loop verification

## Stage: TEI (tei-e2e) — DONE 2026-07-07

Reality check: TEI ran `MEMORY_ENGINE=agentcore` with NO Hindsight infra —
this was a first-time enablement on the fresh-stage path (no data
migration, no function install), not a schema cutover. Executed via the
deployment controller with the patched runner (payload
`enableHindsight: true` + `hindsightDatabaseName: thinkwork_hindsight`,
release v0.1.0-canary.330; plan-first, then update).

- [x] Plan reviewed: 15 creates (hindsight module) / 4 updates / no real deletes
- [x] Runner automation created the database + pgvector (`ensure_hindsight_database`, PR #3511)
- [x] Update applied via controller (SUCCEEDED); transient ghcr pull timeout on first task, ECS retry stabilized 1/1
- [x] Maintenance loop verified clean in `/thinkwork/tei-e2e/hindsight` (retention / reconcile / mental-model, zero warnings)
- [ ] Retain smoke on a live tenant thread (first organic traffic will show in `memory_retain_attempts`)
- Note: prior AgentCore managed memories are not migrated — memory starts fresh (accepted; no production usage)

## Stage: McPherson — DONE 2026-07-07

Same fresh-stage first-time enablement as TEI (was `agentcore`, no
Hindsight infra), same controller flow and release.

- [x] Plan reviewed (identical shape to TEI)
- [x] Runner automation created the database + pgvector
- [x] Update applied via controller (SUCCEEDED), service 1/1 immediately
- [x] Maintenance loop verified clean in `/thinkwork/mcpherson/hindsight`
- [ ] Retain smoke on a live tenant thread (first organic traffic)
- Note: prior AgentCore managed memories not migrated (accepted)

## Fresh stages (no existing Hindsight data)

No dump/restore: provision the database empty (pgvector + vanilla boot runs
all migrations, including the repair migration that installs the discovery
functions — maintenance-functions.sql is NOT needed), set
`hindsight_database_name` from day one. The greenfield path should default
to the dedicated database once dev soaks clean.
