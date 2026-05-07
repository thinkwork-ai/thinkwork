---
title: "Phase 2 U6: Drop SW + Activation schema + Postgres tables"
type: refactor
status: completed
date: 2026-05-06
origin: docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md
---

# Phase 2 U6: Drop SW + Activation schema + Postgres tables

## Summary

Final unit of the System Workflows revert. Drop the 11 remaining Postgres tables (4 activation + 7 SW), delete the corresponding Drizzle schema TS files + their re-exports, delete the create-migration files, and add a single forward-drop migration with `-- drops:` markers so the drift gate verifies the tables are gone. Hand-rolled migration → must be applied to `dev` via `psql -f` BEFORE merge to satisfy the drift-gate ordering.

---

## Problem Frame

Parent plan establishes the full motivation. Briefly: U2 deleted the GraphQL/UI surface, U3 deleted the Lambda library + 5 handlers, U4 deleted the AgentCore activation runtime source, U5 destroyed the Step Functions module + IAM. The 11 Postgres tables remain — in dev they hold (likely) zero rows since U2 removed all writers, and the schema TS files still ship in `@thinkwork/database-pg/schema` with re-exports in `packages/api/src/graphql/utils.ts` (flagged as deferred-to-U6 cleanup in U4's review). U6 closes the loop.

See origin: `docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md`.

---

## Requirements

- R1. Carries forward parent R3/R4 (Activation feature removed at the persistence layer; multi-step orchestration data model gone).
- R2. All 11 tables removed from `dev` Postgres: `activation_sessions`, `activation_session_turns`, `activation_apply_outbox`, `activation_automation_candidates`, `system_workflow_definitions`, `system_workflow_configs`, `system_workflow_extension_bindings`, `system_workflow_runs`, `system_workflow_step_events`, `system_workflow_evidence`, `system_workflow_change_events`.
- R3. `pnpm db:migrate-manual` (the deploy-time drift gate at `.github/workflows/deploy.yml:670-724`) passes post-deploy: every `-- creates:` marker still in the source tree matches a real DB object, and every `-- drops:` marker in the new migration matches an absent DB object.
- R4. `pnpm typecheck` and `pnpm test` stay green across the workspace. No remaining importers reference the deleted schema exports.
- R5. The drop migration apply happens **before** PR merge, not after, so deploy.yml's drift gate sees a clean DB state on the first apply and never blocks the deploy.

---

## Scope Boundaries

- Forward-drop migration only. No "soft delete" / "rename to `*_archived`" path — the parent brainstorm explicitly rejected the audit-archival approach in favor of the upcoming Phase 3 Compliance log starting fresh.
- No data export. The activation + SW tables in dev hold internal in-progress agent state (no customer-bound data, no SOC2-evidence rows) — the parent brainstorm's Phase 3 Compliance log is the future audit trail, not this data.
- Cross-stage rollout (staging/prod): N/A. `deploy.yml` hardcodes `STAGE=dev`; only the dev DB has these tables. If a staging/prod DB ever gets these tables, the same hand-rolled apply pattern applies per-stage operationally.

### Deferred to Follow-Up Work

- None. U6 is the terminal unit of Phase 2. Any post-U6 cleanup is Phase 3 (Compliance log) brainstorm territory, not deferred Phase 2 work.

---

## Context & Research

### Relevant Code and Patterns

- **Schema TS files to delete** (verified at planning time):
  - `packages/database-pg/src/schema/system-workflows.ts` (13.7K, 7 `pgTable` exports)
  - `packages/database-pg/src/schema/activation.ts` (9.1K, 4 `pgTable` exports + 4 relations + enum constants)
- **Re-export sites**:
  - `packages/database-pg/src/schema/index.ts:61-62` — `export * from "./activation"; export * from "./system-workflows";`
  - `packages/api/src/graphql/utils.ts:104-107` — imports of 4 activation tables
  - `packages/api/src/graphql/utils.ts:189-192` — re-exports of those same 4 names
- **Existing hand-rolled create-migrations** (NOT in `packages/database-pg/drizzle/meta/_journal.json`):
  - `packages/database-pg/drizzle/0038_activation_sessions.sql` (creates `activation_sessions` + `activation_session_turns`; no rollback file)
  - `packages/database-pg/drizzle/0039_activation_apply_outbox.sql` (creates `activation_apply_outbox`; no rollback)
  - `packages/database-pg/drizzle/0041_activation_automation_candidates.sql` (creates `activation_automation_candidates`; no rollback)
  - `packages/database-pg/drizzle/0059_system_workflows.sql` (creates 7 SW tables + many indexes) + `0059_system_workflows_rollback.sql`
  - `packages/database-pg/drizzle/0060_system_workflow_run_domain_ref_dedup.sql` (adds 1 partial unique index) + `0060_system_workflow_run_domain_ref_dedup_rollback.sql`
- **Drift gate** (`scripts/db-migrate-manual.sh:1-50`): walks `packages/database-pg/drizzle/*.sql` excluding journal-tracked files; for each, parses `-- creates:`, `-- creates-column:`, `-- creates-extension:`, `-- creates-constraint:`, `-- creates-function:`, `-- creates-trigger:`, `-- drops:`, `-- drops-column:` markers and probes the DB. Files without markers are reported as `UNVERIFIED`. The deploy.yml job at `.github/workflows/deploy.yml:670-724` runs this after `terraform-apply` and fails the deploy on drift.
- **Dev DB credential resolution** (per memory `project_dev_db_secret_pattern`): `aws secretsmanager get-secret-value --region us-east-1 --secret-id thinkwork-dev-db-credentials` → JSON with `username` + `password`; endpoint = `thinkwork-dev-db.cluster-cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`; password contains `!` which URL-encodes to `%21` in `DATABASE_URL`. For `psql` direct invocation (no Node URL parsing), the raw password works.

### Institutional Learnings

- `feedback_handrolled_migrations_apply_to_dev` (PRs #833 + #835 cost from 2026-05-06) — hand-rolled migrations need `psql -f` apply to dev before PR merge or the deploy gate trips. **This is the load-bearing operational rule for U6.**
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — the canonical drift-from-dev write-up. Three drift incidents in five days drove this gate's introduction; U6 is exactly the shape of risk it's designed to catch.
- `feedback_diff_against_origin_before_patching` — re-verify line numbers in `schema/index.ts` and `graphql/utils.ts` against current `main` immediately before editing; intervening merges may have shifted them.
- `feedback_worktree_isolation` + `feedback_cleanup_worktrees_when_done` — same shape as U2-U5.
- `feedback_merge_prs_as_ci_passes` — engineers blocked → squash-merge as CI green.

### External References

- None. Drizzle ORM patterns are well-established locally; PostgreSQL `DROP TABLE ... CASCADE` semantics are standard.

---

## Key Technical Decisions

- **Single forward-drop migration vs three.** One migration `00NN_drop_system_workflows_and_activation.sql` covering all 11 tables. Granular per-feature rollback isn't needed because this is the terminal cleanup; if anyone needs to recreate the tables, they pull the pre-U6 git commit. The migration uses `DROP TABLE IF EXISTS ... CASCADE` for each table so the drop is idempotent and tolerant of partial-prior-applies.
- **`-- drops:` markers on the new migration are mandatory, not optional polish.** The drift gate supports `-- drops:` markers (`scripts/db-migrate-manual.sh:43`); using them gives the gate a positive-verification signal that the tables are absent. **A file with zero markers reports `UNVERIFIED` and the script exits 1** (per `db-migrate-manual.sh:309-312` + `412-414` — UNVERIFIED triggers the same failure path as MISSING). Skipping markers would block the post-deploy drift gate. Use `-- drops:` for all 11 tables AND `-- drops:` for every distinct index/constraint that the deleted create-migrations declared (~47 objects total) so the audit trail in the new migration matches what's actually being removed. CASCADE handles the runtime drop of indexes alongside their parent tables, but the marker enumeration is the documentation surface future operators will read.
- **Migration body must set `lock_timeout` + `statement_timeout`** to prevent a stuck connection from wedging the dev cluster. `DROP TABLE` requires `ACCESS EXCLUSIVE` lock on the target; if any other session holds even a shared lock (an idle psql window, a warm Lambda connection pool), the transaction blocks indefinitely on Postgres's default unbounded `lock_timeout`. Mirror the pattern from `packages/database-pg/drizzle/0031_thread_cleanup_drops.sql`: `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';` at the top of the `BEGIN` block. Fail fast on contention; don't wedge the cluster.
- **Migration prelude includes a `current_database()` guard** that refuses to apply against an unexpected DB. `DO $$ BEGIN IF current_database() != 'thinkwork' THEN RAISE EXCEPTION 'wrong database: %', current_database(); END IF; END $$;`. Defense against stale `DATABASE_URL` env vars pointing at a localhost Postgres or a non-dev RDS — the drop is irreversible without snapshot restore, so the in-script guard is cheap insurance against an operational mistake.
- **Delete the create-migration files** (5 forward + 2 rollback = 7 files). Their `-- creates:` markers would break the drift gate post-drop because the tables they declared no longer exist. The git history preserves the audit trail. Alternative kept-and-marked approach (add `-- drops:` to the create files) is rejected: it conflates the "this file creates X" record with "X has been dropped" — confusing for future archaeologists.
- **Apply-before-merge ordering**. The drop migration must be `psql -f`-applied to dev BEFORE the PR merges, not after. Reasoning: deploy.yml's drift gate runs post-`terraform-apply` and fails the deploy if any `-- creates:` marker doesn't match. If we deleted the create-migrations + added the drop migration but did NOT apply the drop in dev first, the create files are gone (so no `-- creates:` markers to fail on), BUT the new drop migration's `-- drops:` markers would report `STILL_PRESENT` in dev → drift gate fails. Apply-first ensures the drift gate sees a consistent end-state.
- **No data export / archival.** Per parent brainstorm, the future Compliance log starts fresh; no audit-evidence value in preserving the existing in-progress activation/SW state.
- **Worktree off `origin/main`**, branch `refactor/sw-revert-phase-2-u6`, single squash-merged PR — same shape as U2/U3/U4/U5.

---

## Open Questions

### Resolve Before Work

- **RBW1**: Re-verify line numbers immediately before editing:
  - `packages/database-pg/src/schema/index.ts` should still have `export * from "./activation"` and `export * from "./system-workflows"` lines (planning-time: lines 61-62).
  - `packages/api/src/graphql/utils.ts` should still have the 4 activation imports (planning-time: lines 104-107) AND the 4 activation re-exports (planning-time: lines 189-192).
  - If line numbers shifted, use the symbol names (`activationSessions`, etc.) not the line numbers.
- **RBW2**: Repo-wide consumer survey: `grep -rln "activationSessions\|activationSessionTurns\|activationApplyOutbox\|activationAutomationCandidates\|systemWorkflowDefinitions\|systemWorkflowConfigs\|systemWorkflowExtensionBindings\|systemWorkflowRuns\|systemWorkflowStepEvents\|systemWorkflowEvidence\|systemWorkflowChangeEvents" packages/ apps/ --include="*.ts" --include="*.tsx"` — should return only `packages/database-pg/src/schema/{activation,system-workflows}.ts` (the files being deleted) + `packages/api/src/graphql/utils.ts` (the re-export site). Anything else means a missed cleanup target — add it to the modify list and re-survey.
- **RBW3**: Pre-flight row count: `psql "$DATABASE_URL" -c "SELECT 'activation_sessions' AS t, COUNT(*) FROM activation_sessions UNION ALL SELECT 'activation_session_turns', COUNT(*) FROM activation_session_turns UNION ALL SELECT 'activation_apply_outbox', COUNT(*) FROM activation_apply_outbox UNION ALL SELECT 'activation_automation_candidates', COUNT(*) FROM activation_automation_candidates UNION ALL SELECT 'system_workflow_definitions', COUNT(*) FROM system_workflow_definitions UNION ALL SELECT 'system_workflow_configs', COUNT(*) FROM system_workflow_configs UNION ALL SELECT 'system_workflow_extension_bindings', COUNT(*) FROM system_workflow_extension_bindings UNION ALL SELECT 'system_workflow_runs', COUNT(*) FROM system_workflow_runs UNION ALL SELECT 'system_workflow_step_events', COUNT(*) FROM system_workflow_step_events UNION ALL SELECT 'system_workflow_evidence', COUNT(*) FROM system_workflow_evidence UNION ALL SELECT 'system_workflow_change_events', COUNT(*) FROM system_workflow_change_events;"`. Expected: all rows show `0` or low counts (test fixtures). If any table has > a few hundred rows, surface to the user before proceeding — though the parent brainstorm explicitly rejected archival, an unexpected row count is worth eyeballing once.
- **RBW4**: Pre-flight: confirm latest deploy succeeded post-U5. `gh run list --workflow=deploy.yml --branch=main --status=success --limit=1` should show a SHA at-or-after `24ca967f` (PR #871). If not, U5's destroys haven't applied yet and the drift gate may misbehave.
- **RBW5**: Apply the new drop migration to dev BEFORE pushing the PR: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/00NN_drop_system_workflows_and_activation.sql` from a shell with the DATABASE_URL constructed per the dev DB secret pattern. Verify post-apply: all 11 tables return `relation does not exist` on `\d <table_name>`. **This is the single most important step in U6.** The drift gate post-merge fails if this step is skipped; there is no CI guard before merge. Confirm correct DB target before running: `psql "$DATABASE_URL" -c "SELECT current_database(), inet_server_addr()"` should return `thinkwork` and the dev RDS endpoint.
- **RBW6**: Verify zero inbound foreign keys from kept tables INTO the 11 SW/activation tables before applying the drop. Schema-TS grep catches Drizzle-declared FKs but misses any that hand-rolled migrations may have added directly via raw `ALTER TABLE ... ADD CONSTRAINT`. Run: `psql "$DATABASE_URL" -c "SELECT conrelid::regclass AS from_table, confrelid::regclass AS to_table, conname FROM pg_constraint WHERE confrelid::regclass::text = ANY(ARRAY['public.activation_sessions','public.activation_session_turns','public.activation_apply_outbox','public.activation_automation_candidates','public.system_workflow_definitions','public.system_workflow_configs','public.system_workflow_extension_bindings','public.system_workflow_runs','public.system_workflow_step_events','public.system_workflow_evidence','public.system_workflow_change_events']) AND contype = 'f';"`. Expected: 0 rows. Non-zero = a kept table has an inbound FK that CASCADE will drop silently — surface to the user before applying.

### Resolved During Planning

- **Drift gate supports both `-- creates:` and `-- drops:` markers** (`scripts/db-migrate-manual.sh:36-44`). The new migration uses `-- drops:` for the 11 tables AND for every distinct index/constraint that the deleted create-migrations declared (~47 markers); UNVERIFIED status is a deploy-blocker (script exits 1 on UNVERIFIED at lines 309-312 + 412-414), not optional polish.
- **Re-export site is exactly one file** (`packages/api/src/graphql/utils.ts`). U4's agent-native review flagged this as deferred-to-U6; the survey at planning time confirmed no other consumer.
- **No SW table consumers in any handler/lib/resolver post-U2/U3/U5**: planning-time `grep -rln "systemWorkflow*"` returns only `packages/database-pg/src/schema/system-workflows.ts` itself.
- **Deploy gate location**: `.github/workflows/deploy.yml:670-724` (`migration-drift-check` job) runs after `terraform-apply` succeeds.

### Deferred to Implementation

- The exact next migration sequence number. **Planning-time check shows `0067_*` is the highest existing** (sequence numbers 0061 through 0067 are already taken by unrelated migrations: routine_execution_asl_version_id, migrate_pi_to_flue, threads_session_data, tenant_credentials, connector_tables, extend_external_refs_source_kind, thinkwork_computers_phase_one). Next available is `0068_drop_system_workflows_and_activation.sql`. Verify at impl time in case other unrelated PRs land between now and merge.
- Whether to apply via `psql -f` against the prod DB. Out of scope for U6 — `STAGE=dev` is the only deployed stage; this question doesn't arise unless/until staging or prod is provisioned with the SW + activation tables.

---

## Implementation Units

- U1. **Drop SW + Activation schema, tables, and migration files**

**Goal:** Single coordinated PR + 1 operational `psql -f` step that drops the 11 tables in dev, removes the schema TS files + index/utils re-exports, deletes the 7 stale migration files, and adds the new drop migration as the drift-gate-verified record of the change.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** U2 (PR #848, merged + deployed), U3 (PR #851 + #853, merged + deployed), U4 (PR #855 + #857, merged + deployed), U5 (PR #871 + #872, merged + deployed). U2 severed all writers; U5 was the most recent and is the floor for RBW4.

**Files:**
- Delete (entire schema TS):
  - `packages/database-pg/src/schema/system-workflows.ts`
  - `packages/database-pg/src/schema/activation.ts`
- Delete (hand-rolled migration files — 5 forward + 2 rollback):
  - `packages/database-pg/drizzle/0038_activation_sessions.sql`
  - `packages/database-pg/drizzle/0039_activation_apply_outbox.sql`
  - `packages/database-pg/drizzle/0041_activation_automation_candidates.sql`
  - `packages/database-pg/drizzle/0059_system_workflows.sql`
  - `packages/database-pg/drizzle/0059_system_workflows_rollback.sql`
  - `packages/database-pg/drizzle/0060_system_workflow_run_domain_ref_dedup.sql`
  - `packages/database-pg/drizzle/0060_system_workflow_run_domain_ref_dedup_rollback.sql`
- Modify:
  - `packages/database-pg/src/schema/index.ts` — remove the `export * from "./activation";` and `export * from "./system-workflows";` lines.
  - `packages/api/src/graphql/utils.ts` — remove the 4 activation table imports (planning-time lines 104-107) AND the 4 activation table re-exports (planning-time lines 189-192).
- Create:
  - `packages/database-pg/drizzle/0068_drop_system_workflows_and_activation.sql` (verify next sequence number is still 0068 at impl time). Header declares `Apply manually:` instructions + `-- drops: public.X` markers for all 11 tables AND for every distinct index/constraint the deleted create-migrations declared (~47 markers total — matches what CASCADE actually removes). Body opens `BEGIN;`, sets `lock_timeout = '5s'` and `statement_timeout = '60s'` (per `0031_thread_cleanup_drops.sql`), runs the `current_database() != 'thinkwork'` guard via `DO $$ ... END $$;`, then issues `DROP TABLE IF EXISTS public.<name> CASCADE;` for each table in dependency-safe reverse order (children before parents), `COMMIT;`.

**Approach:**
- **Pre-flight (RBW1-RBW6)**: re-verify line numbers, run consumer-survey grep, snapshot row counts, confirm latest deploy succeeded, verify zero inbound FKs.
- **Worktree**: `git worktree add .claude/worktrees/sw-revert-phase-2-u6 -b refactor/sw-revert-phase-2-u6 origin/main`.
- **Bootstrap**: `pnpm install`, kill stale tsbuildinfos, `pnpm --filter @thinkwork/database-pg build`.
- **Author the new drop migration first** (before any source-tree deletion). Use the file-header convention from existing hand-rolled migrations. Body opens `BEGIN;`, sets `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';` (per `0031_thread_cleanup_drops.sql`), then a `DO $$ BEGIN IF current_database() != 'thinkwork' THEN RAISE EXCEPTION 'wrong database: %', current_database(); END IF; END $$;` guard, then `DROP TABLE IF EXISTS public.<name> CASCADE;` for each table. Dependency-safe drop order (children before parents): SW: change_events → evidence → step_events → runs → extension_bindings → configs → definitions; activation: apply_outbox → automation_candidates → session_turns → sessions. CASCADE makes the order tolerant; explicit ordering plus CASCADE is belt-and-suspenders.
- **Apply the migration to dev (RBW5 — the load-bearing operational step)**: from a shell with `DATABASE_URL` set per `project_dev_db_secret_pattern`, first verify the target with `psql "$DATABASE_URL" -c "SELECT current_database(), inet_server_addr()"` (expect `thinkwork` + the dev RDS endpoint). Then run `psql "$DATABASE_URL" -f packages/database-pg/drizzle/00NN_drop_system_workflows_and_activation.sql`. Verify post-apply with a single `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (...)` query that returns 0 rows.
- **Edit the source tree** (do this AFTER applying to dev — though the order doesn't strictly matter, applying first proves the drop is reversible-via-git if anything goes wrong on the source-tree side):
  1. Remove the 2 `export * from` lines in `schema/index.ts`.
  2. Remove the 8 lines (4 imports + 4 re-exports) in `graphql/utils.ts`.
  3. `git rm` the 2 schema TS files.
  4. `git rm` the 7 hand-rolled migration files.
- **Verify (TS)**: `pnpm -r --if-present typecheck` — clean. RBW2 confirmed no remaining importers.
- **Verify (tests)**: `pnpm -r --if-present test` — clean. No test depends on these tables (the related tests were deleted in U3 + U4).
- **Verify (drift gate, locally)**: from the worktree with `DATABASE_URL` set, run `bash scripts/db-migrate-manual.sh`. Expected output:
  - 0061 drop migration: every `-- drops:` marker reports `DROPPED` (not `STILL_PRESENT`).
  - No remaining hand-rolled migration files reference the dropped tables.
  - Other unaffected hand-rolled migrations still verify their own creates.
  - Exit 0.
- **Format**: `pnpm exec prettier --check` on changed `*.ts` files (the migration `.sql` is not in prettier scope).
- **Commit + push + open PR** against `main`. Engineers blocked → squash-merge as CI green.
- **Post-merge**: deploy pipeline runs. terraform-apply diff for U6 is empty (no Terraform changes). Migration-drift-check job runs against the now-applied state in dev → exits 0 because the drop migration's markers match the post-apply state.

**Patterns to follow:**
- Migration header convention: see `packages/database-pg/drizzle/0041_activation_automation_candidates.sql:1-5` for the `-- Apply manually:` / `-- Then verify:` shape.
- Existing `-- drops:` marker usage: search the existing drizzle/ for any prior drop-style hand-rolled migration as a reference. Even if none exists, the marker shape is documented in `scripts/db-migrate-manual.sh:43`.
- Drift-gate apply-before-merge per `feedback_handrolled_migrations_apply_to_dev`.

**Test scenarios:**
- *Test expectation: none for code paths — no logic changes.* The verification gates are the 4 RBW pre-flight + the drift gate post-merge. No vitest test will be added; no existing test referenced these tables (verified at planning time).
- *Integration (post-deploy):*
  - `pnpm db:migrate-manual` from CI's drift-check job exits 0.
  - `psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('activation_sessions', 'activation_session_turns', 'activation_apply_outbox', 'activation_automation_candidates', 'system_workflow_definitions', 'system_workflow_configs', 'system_workflow_extension_bindings', 'system_workflow_runs', 'system_workflow_step_events', 'system_workflow_evidence', 'system_workflow_change_events');"` returns 0 rows.
  - All other tables (routines, agents, threads, etc.) remain present (regression guard against cascade-drop running wild). Spot-check via `\d agents` returning the expected schema.

**Verification:**
- All CI checks (cla, lint, verify, test, typecheck) green on the PR.
- `pnpm exec prettier --check` clean on changed TS files.
- `pnpm db:migrate-manual` (locally + in deploy.yml's drift-check job) exits 0.
- Post-merge in dev: 0 of the 11 tables remain (`information_schema.tables` query returns 0).
- Post-merge: the deploy pipeline's `migration-drift-check` job succeeds.

---

## System-Wide Impact

- **Interaction graph:** None. U2 already removed all GraphQL writers; U3 removed the Lambda library that called the schema; U4 removed the Python runtime; U5 destroyed the Step Functions module. U6 removes the data layer that all those tiers used to write to. No remaining interaction surface.
- **Error propagation:** Any cold-cache hit on a dropped table would surface as `relation does not exist` from Postgres. RBW2's importer survey confirms zero remaining query sites; the only path that would error is direct `psql` access by an operator, which is by definition human-in-the-loop.
- **State lifecycle risks:** Drop is irreversible without restoring from RDS automated snapshots. Parent brainstorm explicitly rejected archival. If a future need to inspect pre-drop state arises, the dev DB's automated daily snapshot is the recovery mechanism.
- **API surface parity:** Already at zero post-U2.
- **Integration coverage:** Drift gate is the single integration check. It runs in deploy.yml after `terraform-apply` and fails the deploy on drift, which is the regression safety net.
- **Unchanged invariants:** All other Drizzle schemas (agents, threads, messages, memory, routines, computers, connectors, etc.) untouched. The Drizzle journal tracks NOT-our-domain migrations (auto-tracked); none of those reference SW/activation tables.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Drop migration applied to dev but PR doesn't merge cleanly (CI fail or merge conflict) — leaves dev in a state where source declares no SW/activation tables but dev DB also has no SW/activation tables (consistent), but merging requires another retry | Drop is idempotent (`DROP TABLE IF EXISTS ... CASCADE`); re-applying is a no-op. Source tree edits are reversible via `git restore`. Worst case: dev is fine, source tree gets reset, retry. |
| Drift gate fails post-deploy because some `-- creates:` marker for an unrelated migration broke independently | RBW4 confirms latest deploy was green; drift gate is a known-good baseline immediately before this PR. Any new failure post-merge is by definition this PR's responsibility — investigate immediately. |
| Operator forgets the `psql -f` apply step before pushing the PR — deploy fails on drift gate | RBW5 is explicit and named "the single most important step in U6." Plan-doc + PR body both reference it. Deploy gate failure is the catch-all backstop. |
| Unexpected non-zero row count in any of the 11 tables (RBW3) suggesting recent activity | Surface to user before applying the drop. Parent brainstorm explicitly rejected archival, but a row count of (say) 1000+ might warrant a pre-drop snapshot of the data into S3 as a one-time precaution. Most likely outcome: 0 or low test-fixture counts. |
| Other PRs adding higher-numbered hand-rolled migrations between planning and merge (file conflict on the new 0068 sequence number) | Verify the next sequence number at execution time, not planning time. Planning-time check shows 0061-0067 are already taken, so 0068 is the planning-time anchor; if more land before merge, use the next available. |
| Drop migration applied + PR merged + something else forces a revert post-merge | Forward-fix: the revert restores the create-migration files (with `-- creates:` markers declaring 11 tables exist) but dev DB still has no tables → next deploy's drift gate fails with all 11 markers reporting MISSING. **Recovery is forward-only**: open a follow-up PR that re-deletes the create files + re-adds the drop migration, OR re-apply the original create migrations (0038, 0039, 0041, 0059, 0060) against dev to restore the declared state. Snapshot restore is the heaviest option. Document the forward-fix path in the PR body so an operator under deploy pressure isn't reasoning from scratch. |
| `DROP TABLE` blocks indefinitely on lock contention from a stale connection | `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';` at the top of the migration body fails fast on contention. If the apply errors with `lock timeout`, identify and close the contending session (`SELECT * FROM pg_stat_activity WHERE state != 'idle' AND query !~ 'pg_stat_activity'`) before retrying. |
| Operator runs `psql -f` against a non-dev DB (stale env, localhost fallback) | Migration prelude includes `current_database() != 'thinkwork'` guard that aborts with a clear exception. RBW5's `SELECT current_database(), inet_server_addr()` pre-flight is the human-side check. |
| `CASCADE` on `DROP TABLE` accidentally drops something it shouldn't (e.g., a foreign-key-referencing row in a kept table) | The 11 tables form a closed dependency graph internal to SW + activation. No other table has a foreign key INTO any of these (verified via planning-time read of the schema TS files — relations are intra-SW and intra-activation only). `CASCADE` here is just defense-in-depth against mid-drop ordering issues, not an actual cross-domain risk. |

---

## Documentation / Operational Notes

- No user-facing docs touched.
- Operational impact: 11 tables disappear from the `dev` Postgres. Storage reclaimed: small (kilobytes — these tables held in-progress agent state with low row counts).
- The new drop migration becomes the historical record. Future archaeologists (`git log packages/database-pg/drizzle/`) see the create migrations in pre-U6 commits and the drop migration in U6.
- Memory file `project_system_workflows_revert_compliance_reframe.md` should be updated post-merge to reflect U6 SHIPPED + Phase 2 COMPLETE.
- Phase 3 (Compliance audit-event log) starts as a separate plan/brainstorm cycle. U6 closes Phase 2 cleanly.

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md](docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md)
- **Brainstorm:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md)
- **Predecessor PRs:** #845 (Phase 1), #846 (Phase 2 U1), #848 (Phase 2 U2), #851 + #853 (Phase 2 U3), #855 + #857 (Phase 2 U4), #871 + #872 (Phase 2 U5).
- **Drift gate:** [scripts/db-migrate-manual.sh](scripts/db-migrate-manual.sh) (marker convention) + [.github/workflows/deploy.yml](.github/workflows/deploy.yml) lines 670-724 (deploy-time job).
- **Drift-from-dev write-up:** [docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md](docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md)
- **Memory:** `project_system_workflows_revert_compliance_reframe.md`, `feedback_handrolled_migrations_apply_to_dev.md`, `project_dev_db_secret_pattern.md`
