---
title: "refactor: Pre-Launch Database Schema Cleanup"
type: refactor
status: active
date: 2026-04-24
origin: docs/brainstorms/2026-04-24-pre-launch-db-schema-cleanup-requirements.md
---

# refactor: Pre-Launch Database Schema Cleanup

## Overview

Drop nine v0/parked tables from the Postgres `public` schema and remove every consumer surface across the API, Lambdas, terraform, mobile, CLI, and docs. Ships as a single PR with one hand-rolled migration `0028_pre_launch_cleanup.sql` (ordinal 0028 because 0026 is taken by `2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md` and 0027 by `2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`).

The `db-migrate-manual.sh` reporter currently recognizes only `-- creates:` markers; the `-- drops:` extension this migration depends on is owned by plan 002 (its U5). This plan does **not** duplicate that work — it consumes it as a dependency.

The brainstorm already resolved the scope decisions (which tables go, which stay, what the surrounding strategy is). This plan resolves the *how*: FK drop ordering, codegen-driven UI sweeps, Lambda + API Gateway de-provisioning, and the GitHub App de-installation sequence. The drop pattern itself is not novel — `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` is the existing drop precedent.

---

## Problem Frame

The schema has accumulated v0-era tables that v1 superseded — `recipes` (replaced by skills), `workflow_configs` (composition orchestrator retired), `code_factory_*` + `github_app_*` (parked autonomous-PR feature), plus two genuinely dead tables (`documents`, `principal_permission_grants`). Carrying these into launch keeps GraphQL/admin/mobile/CLI code wired to retired concepts, leaves a GitHub App registration that customers could theoretically install against a backend that no longer services it, and leaves the `packages/database-pg/src/schema/index.ts` barrel header lying about what's exported (it lists `workflow-configs` as cut while line 35 still re-exports it).

See origin: `docs/brainstorms/2026-04-24-pre-launch-db-schema-cleanup-requirements.md`.

---

## Requirements Trace

- R1. Drop `documents` table and remove every consumer (`see origin: R1`).
- R2. Drop `principal_permission_grants` table (`see origin: R2`).
- R3. Drop `recipes` table and remove GraphQL types, resolvers, mobile components, and CLI command (`see origin: R3`).
- R4. Drop the five Code Factory tables (`see origin: R4`).
- R5. Remove API Lambda handlers and esbuild entries for `code-factory`, `github-app`, `github-repos`, `github-app-webhook`, `github-app-callback`, `recipe-refresh` (`see origin: R5, R6`).
- R6. Remove GitHub App terraform: API Gateway routes, Lambda function references, Secrets Manager private key, IAM policy entries (`see origin: R7`).
- R7. Sweep documentation that describes Code Factory or the GitHub App as a product capability (`see origin: R8`).
- R8. Drop `workflow_configs` table and remove its orchestration resolvers (`see origin: R9`).
- R9. Reconcile `packages/database-pg/src/schema/index.ts` header so it describes the post-cleanup state truthfully (`see origin: R10`).
- R10. Ship as a single hand-rolled migration `0028_pre_launch_cleanup.sql` with FK drops sequenced before owning-table drops, using `-- drops:` markers per the convention plan 002 (`docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` U5) introduces (`see origin: R11`).
- R11. Update `packages/database-pg/src/schema/*.ts` exports in the same PR as the migration so deploy cannot land in a half-state (`see origin: R12`).
- R12. Regenerate GraphQL codegen in `packages/api`, `apps/admin`, `apps/mobile`, `apps/cli` and remove dead screens/hooks/routes surfaced by codegen failures (`see origin: R13`).

---

## Scope Boundaries

- **Out of scope: threads-area cleanup.** `thread_comments`, `thread_attachments`, `message_artifacts`, `threads.parent_id`, `threads.status`/`priority`/`type`, `thread_dependencies` are owned by `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`. This plan must not touch them.
- **Out of scope: row-level data migrations.** No `INSERT … SELECT` rescue, no row export, no archiving. Tables are dropped wholesale; brainstorm Key Decisions confirm row loss on the dropped tables is acceptable.
- **Out of scope: kept-table audits.** `knowledge_bases`, `teams`, `guardrails`, `inbox_items`, `email_reply_tokens` flagged in the brainstorm as follow-up audit candidates remain in the schema. A separate brainstorm post-launch.
- **Out of scope: `quick_actions`.** User confirmed during brainstorm that `user_quick_actions` feeds an upcoming mobile feature; do not drop.
- **Out of scope: rename of `principal_permission_grants`.** Moot once dropped.
- **Out of scope: `pnpm db:migrate-manual` reporter rewrite.** Plan 002 owns the `-- drops:` marker extension; this plan consumes it. Broader reporter work (UNVERIFIED-as-error gating, post-state assertions) stays a separate effort.
- **Out of scope: extending `db-migrate-manual.sh` for `-- drops:` markers.** Owned by `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` U5; this plan depends on that work landing first or co-shipping in the same deploy window.

### Deferred to Follow-Up Work

- `/ce-compound` capture for two reusable lessons (GitHub App de-provisioning runbook template, codegen as dead-caller finder): a separate compound capture session after merge. Note: "first DROP migration" was incorrect framing — `0016_wiki_schema_drops.sql` already exists as precedent.

---

## Context & Research

### Relevant Code and Patterns

- `docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md` — closest precedent for multi-surface retirement (admin routes + mobile + Lambda build + docs). Mirror its unit decomposition and "Allowed diff rule" for regenerated artifacts.
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — existing drop-migration precedent (drops two columns with header markers + `DO $$` pre-flight).
- `packages/database-pg/drizzle/0023_tenants_deactivation.sql`, `0024_tenant_mcp_admin_keys.sql`, `0025_v1_agent_architecture.sql` — hand-rolled migration template (header markers, `to_regclass` pre-flight, `DO $$` guards for idempotent constraints).
- `packages/database-pg/src/schema/code-factory.ts` lines 30, 62, 65, 67, 89, 92, 115, 137 — FK structure: `code_factory_runs.job_id → code_factory_jobs.id`, `code_factory_jobs.repo_id → code_factory_repos.id`, all five tables → `tenants.id`, `code_factory_jobs.agent_id → agents.id`. No inbound FKs from kept tables. `github_*` and `code_factory_*` are independent FK subgraphs both rooted at `tenants` — drop ordering within each subgraph is independent.
- `packages/database-pg/src/schema/recipes.ts`, `workflow-configs.ts` — standalone drop-target schema files (delete entirely).
- `packages/database-pg/src/schema/messages.ts:92` (`documents` table) and `messages.ts:152` (`documentsRelations`) — both must be removed; `documents` is declared inline in `messages.ts`, not a standalone file.
- `packages/database-pg/src/schema/agents.ts:286` (`principalPermissionGrants` table) and `agents.ts:436` (`principalPermissionGrantsRelations`) — both must be removed; declared inline in `agents.ts`, not a standalone file.
- `packages/api/src/handlers/{code-factory,github-app,github-repos,recipe-refresh}.ts` and `packages/api/{github-app-webhook,github-app-callback}.ts` — six Lambda handler files to delete.
- `packages/api/src/graphql/resolvers/recipes/` — six resolver files (createRecipe / updateRecipe / deleteRecipe / recipe / recipes / index) to delete.
- `packages/api/src/graphql/resolvers/orchestration/{workflowConfig.query,upsertWorkflowConfig.mutation}.ts` — two orphaned workflow-config resolvers (no GraphQL type wires them in; verify and delete).
- `packages/database-pg/graphql/types/recipes.graphql` — sole GraphQL type file for the drop targets (workflow-configs has no .graphql file; code-factory + github-app are not GraphQL-fronted).
- `scripts/build-lambdas.sh` lines 244–254, 289–293 — six handler build entries to remove.
- `terraform/modules/app/lambda-api/handlers.tf` — Lambda function list (`github-app`, `github-repos`, `recipe-refresh`) and API Gateway routes (`POST /api/recipe-refresh`, `ANY /api/github-app/{proxy+}`, `POST /api/github/webhook`).
- `apps/mobile/app/settings/code-factory-repos.tsx` — sole mobile screen for Code Factory.
- `apps/mobile/components/genui/SaveRecipeSheet.tsx`, `apps/mobile/components/agents/agent-detail.tsx`, `apps/mobile/components/threads/ActivityTimeline.tsx`, `apps/mobile/lib/graphql-queries.ts` — mobile recipe consumers.
- `apps/cli/src/commands/recipe.ts`, `apps/cli/src/cli.ts` — CLI recipe command and registration.
- `apps/admin/src/routes/_authed/_tenant/` and `apps/admin/src/components/Sidebar.tsx` — confirmed no Recipe / CodeFactory / WorkflowConfig references; no admin-side cleanup needed.
- `scripts/db-migrate-manual.sh` lines 32–37, 86–110 — drift reporter. Currently understands `-- creates:` and `-- creates-column:` markers via grep + `to_regclass` / information_schema probes. No `-- drops:` support — U10 extends it.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — manually-applied migrations have drifted from dev three times in five days (0008, 0012, 0018/0019). Reporter shipped as the gate; deploy.yml fails on MISSING. **For a drop migration the reporter has no native concept** — extending it (U10) keeps this PR honest rather than punching a documented hole. Existing 0020/0022 migration-number collisions show that ordinals are not contended-checked at PR time; pick `0026` knowing concurrent PRs (today's hindsight refactor and thread-detail cleanup) may also reach for it — coordinate before merge.
- `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md` — generalizes to: pre-flight row counts and FK-referrer counts on dev (and prod when it lands) before merge; document them in PR description.
- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — runbook template for multi-surface retirement: prereqs → run-on-dev-first → explicitly-keeps section → rollback ordering → post-retirement greps. Mirror this shape.
- `docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md` — admin route delete → routeTree regen ("Allowed diff rule" — regen diff must contain only deletions for retired routes) → mobile dead-code → build script entry removal → docs link sweep. Reuse the structure. **Adapt the deferral discipline:** the connectors plan deferred its Secrets Manager audit; this plan does not, because the GitHub App registration is the kind of side-effecting external-customer-facing artifact that cannot be safely deferred past launch.
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` — adjacent: enumerated lists silently miss things and CI doesn't notice. Apply to `scripts/build-lambdas.sh`'s handler list and the `BUNDLED_AGENTCORE_ESBUILD_FLAGS` array. Verification step in U5 must grep for the removed handler names anywhere in the script, not just the lines deleted.

### External References

- None loaded for this plan — all patterns are internal. The brainstorm's product framing already grounded the cleanup in published v1 architectural decisions.

---

## Key Technical Decisions

- **Single migration `0028_pre_launch_cleanup.sql` rather than per-feature migrations.** The brainstorm already settled this; the technical reason is that bundling lets the deploy gate fire once rather than three times. Each `-- drops:` marker stays explicit so the reporter (extended by plan 002 U5) audits each one.
- **Defer the `-- drops:` reporter extension to plan 002.** Plan 002 (`thread-detail-cleanup`) U5 already extends `db-migrate-manual.sh` for `-- drops:` markers because its own `0027_thread_cleanup_drops.sql` needs the same gate. Duplicating the work here risks merge conflicts and wasted effort. This plan declares the dependency explicitly and assumes plan 002 lands first or co-ships.
- **Drop Code Factory schema rather than parking it.** Brainstorm Key Decisions: keeping the schema "in case we revive it" preserves the same drag this plan exists to remove. If the feature returns, it returns with a fresh schema designed for v1+ shape.
- **GitHub App de-provisioning is in-PR, not deferred.** The connectors plan deferred its Secrets Manager audit, but a GitHub App is customer-installable; leaving the App registration alive after the webhook receiver Lambda is gone means installations get 404s. U5 (Lambda + API Gateway) and U7 (terraform IAM/Secrets) coordinate the removal sequence.
- **No graceful deprecation, no row archive, no admin warning.** Each dropped table either has zero callers or sits on a feature surface v1 does not ship. A deprecation banner serves no audience.
- **Codegen-first commit, then sweep.** Each codegen consumer (api, admin, mobile, cli) regenerates in a single mechanical commit so subsequent commits show only human-driven removals. Each generated artifact (`routeTree.gen.ts`, `gql/graphql.ts`) gets the "Allowed diff rule" — diff must contain only deletions referencing retired types.

---

## Open Questions

### Resolved During Planning

- **Does `workflow_configs` have a GraphQL type file?** No. `packages/database-pg/graphql/types/workflow-configs.graphql` does not exist; the orchestration resolvers (`workflowConfig.query.ts`, `upsertWorkflowConfig.mutation.ts`) appear to reference fields that aren't wired into a published schema, or wire through a generic Query block. U6 starts by confirming and deleting orphaned resolvers; codegen regen will surface any remaining wires.
- **Is `code-factory` GraphQL-fronted?** No. It is Lambda + REST. No `.graphql` file references it; cleanup happens at the handler/build/terraform layer only.
- **Are there inbound FKs into the dropped tables from kept tables?** `grep` of `packages/database-pg/src/schema/` for the dropped table TS export names returned only the source files themselves and `workflow-configs.ts` (self). High confidence no kept table references them, but pre-flight `psql` verification is U1.
- **Migration ordinal collision?** Confirmed: plan 001 (`refactor-user-scope-memory-and-hindsight-ingest`) takes `0026_user_scoped_memory_wiki.sql`, plan 002 (`refactor-thread-detail-pre-launch-cleanup`) takes `0027_thread_cleanup_drops.sql` (plus an `0027_rollback_thread_cleanup.sql` companion). This plan claims `0028` to sidestep the collision rather than coordinating at PR-time.
- **Does an existing drop migration set precedent?** Yes — `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` drops two columns with header markers and `DO $$` pre-flight. The original plan claim of "first DROP migration" was wrong; mirror 0016's pattern.
- **Drift reporter `-- drops:` extension owner?** Plan 002 (U5) owns it. This plan depends on 002 landing first or co-shipping; not duplicated here.

### Deferred to Implementation

- **Exact terraform resource graph for the GitHub App.** Beyond `terraform/modules/app/lambda-api/handlers.tf`, the App's Secrets Manager private key, IAM policy attachments, and any pre-signup wiring need full enumeration during U7. Defer to implementation rather than guessing.
- **Whether the GitHub App is currently installed on any tenant org in dev/prod.** Pre-flight check during U7: list installations via the GitHub API; if any exist, revoke before destroying terraform. If brainstorm assumption (no production installs) holds, this is a no-op verification.
- **Foreign-key constraint names in the database** (vs. schema-declared names). FK drops in the migration use the actual constraint names Postgres generated. Discover via `\d+ <table>` during U2 SQL drafting.
- **Whether `apps/admin/src/gql/graphql.ts` regen surfaces any unexpected admin consumers.** No live admin route references the drop targets per current grep, but generated-type imports may exist in test fixtures. Defer to U8.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─ U1: Pre-flight (read-only) ─────────────────────────────────────────┐
│  • Row counts on dev for every dropped table + every FK referrer    │
│  • Confirm no inbound FKs from kept tables                           │
│  • List GitHub App installations (gh api /app/installations)         │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ U2: Migration 0028 (DDL) ───────────────────────────────────────────┐
│  Drop order (FK-leaves first):                                       │
│    1. code_factory_runs                                              │
│    2. code_factory_jobs                                              │
│    3. github_webhook_deliveries                                      │
│    4. github_app_installations                                       │
│    5. code_factory_repos                                             │
│    6. recipes                                                        │
│    7. workflow_configs                                               │
│    8. documents                                                      │
│    9. principal_permission_grants                                    │
│  Headers: -- drops: public.X (one per table)                         │
│  Pre-flight: to_regclass() IS NOT NULL for all 9 (fail-closed)       │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (serial: each waits for the prior)
┌─ U3: Schema TS deletions + index.ts barrel reconciliation ───────────┐
│  • Delete recipes.ts, code-factory.ts, workflow-configs.ts           │
│  • Modify messages.ts (remove documents + documentsRelations)        │
│  • Modify agents.ts (remove principalPermissionGrants + relations)   │
│  • Reconcile index.ts header to match actual exports                 │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ U4: API GraphQL ────────────────────────────────────────────────────┐
│  • Delete recipes/ resolvers (6 files)                               │
│  • Delete workflowConfig/upsertWorkflowConfig resolvers              │
│  • Delete recipes.graphql; pnpm schema:build regen                   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ U5: Lambda handlers + esbuild build script ─────────────────────────┐
│  • Delete 6 handler files (code-factory, github-app, github-repos,   │
│    github-app-webhook, github-app-callback, recipe-refresh)          │
│  • Remove their entries from scripts/build-lambdas.sh                │
└──────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌─ U6: Mobile sweep ─┐  ┌─ U7: CLI sweep ──┐  ┌─ U8: Admin codegen ──┐
│ Codegen-driven for │  │ Delete recipe.ts │  │ Regen + Allowed-diff │
│ recipe consumers + │  │ Unregister in    │  │ rule on graphql.ts   │
│ EXPLICIT delete of │  │ cli.ts           │  │ (deletions only)     │
│ code-factory-      │  │ Codegen regen    │  │                      │
│ repos.tsx (REST,   │  │                  │  │                      │
│ not GraphQL)       │  │                  │  │                      │
└────────────────────┘  └──────────────────┘  └──────────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─ U9: Terraform GitHub App de-provision ──────────────────────────────┐
│  Pre-implementation: grep terraform/ for github_app|github-app|     │
│  code_factory|recipe-refresh — current evidence is only             │
│  modules/app/lambda-api/handlers.tf, but verify before editing.      │
│  • API Gateway routes removed (recipe-refresh, github-app proxy,    │
│    github webhook)                                                  │
│  • Lambda functions removed                                          │
│  • Any Secrets Manager / IAM resources for the App removed           │
│  • Operator runbook for GitHub App un-registration in PR description │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ U10: Docs sweep ────────────────────────────────────────────────────┐
│  • Remove Code Factory + GitHub App pages, nav, cross-links          │
│  • Astro docs build clean                                            │
└──────────────────────────────────────────────────────────────────────┘
```

Note: drop-order detail for U2 (`code_factory_*` and `github_*` are independent FK subgraphs, both rooted at `tenants`):

```
1. code_factory_runs       (FK → code_factory_jobs, tenants)
2. code_factory_jobs       (FK → code_factory_repos, tenants, agents)
3. github_webhook_deliveries (FK → tenants only)
4. github_app_installations  (FK → tenants only)
5. code_factory_repos      (FK → tenants only)
6. recipes                 (no inbound FKs)
7. workflow_configs        (no inbound FKs)
8. documents               (no inbound FKs)
9. principal_permission_grants (no inbound FKs)
```

Cross-plan dependency: U2 needs `db-migrate-manual.sh` to recognize `-- drops:` markers so the deploy gate audits the migration. That extension is owned by `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` U5; this plan does not duplicate it.

---

## Implementation Units

- U1. **Pre-flight verification (read-only)**

**Goal:** Confirm row counts on dev and verify no kept table references the drop targets via FK before the migration is drafted. Also verify GitHub App installation state.

**Requirements:** R1, R2, R3, R4, R8

**Dependencies:** None

**Files:**
- Modify (PR description only): paste verification output

**Approach:**
- For each of `documents`, `principal_permission_grants`, `recipes`, `code_factory_repos`, `code_factory_jobs`, `code_factory_runs`, `github_app_installations`, `github_webhook_deliveries`, `workflow_configs`: run `SELECT COUNT(*) FROM <table>` against the dev DB.
- For each table, run `SELECT conname, conrelid::regclass FROM pg_constraint WHERE confrelid = '<table>'::regclass` to enumerate inbound FKs from any other table.
- Run `gh api /app/installations` (or equivalent GitHub App API call using the App's private key) to list active installations of the Code Factory GitHub App.
- Paste outputs into PR description verbatim. The brainstorm's data-loss-acceptable assumption only holds if dev row counts are zero or trivial; if any table holds non-trivial real data, escalate before continuing.

**Patterns to follow:**
- Pre-flight discipline from `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`.

**Test scenarios:**
- Test expectation: none — read-only investigation; outputs go into PR description.

**Verification:**
- All nine `COUNT(*)` results recorded in PR description.
- All nine FK-referrer queries recorded; expected result is each query returns zero rows or returns only intra-family references (e.g., `code_factory_runs` referencing `code_factory_jobs`).
- GitHub App installation list recorded; if non-empty, U9 needs an installation-revocation step before terraform destroy.

---

- U2. **Migration `0028_pre_launch_cleanup.sql`**

**Goal:** Hand-rolled SQL migration that drops all nine tables in FK-safe order with explicit `-- drops:` markers and pre-flight invariants matching the existing 0023–0025 convention.

**Requirements:** R1, R2, R3, R4, R8, R10

**Dependencies:** U1

**Files:**
- Create: `packages/database-pg/drizzle/0028_pre_launch_cleanup.sql`

**Approach:**
- Header lists every drop with a `-- drops: public.<table>` marker, one per table.
- Pre-flight `DO $$ BEGIN … END $$` block: `RAISE EXCEPTION` if any of the nine `to_regclass('public.X')` returns NULL (refusing to apply against an already-half-cleaned DB).
- Drop order (FK-leaves first):
  1. `DROP TABLE code_factory_runs;`
  2. `DROP TABLE code_factory_jobs;`
  3. `DROP TABLE github_webhook_deliveries;`
  4. `DROP TABLE github_app_installations;`
  5. `DROP TABLE code_factory_repos;`
  6. `DROP TABLE recipes;`
  7. `DROP TABLE workflow_configs;`
  8. `DROP TABLE documents;`
  9. `DROP TABLE principal_permission_grants;`
- Use `DROP TABLE IF EXISTS … CASCADE` only as belt-and-suspenders against any FK from kept tables that U1 missed; the pre-flight already guarantees the table existed at start.
- Migration is NOT registered in `meta/_journal.json` (matches the manually-applied convention from 0023+).

**Patterns to follow:**
- Header shape from `packages/database-pg/drizzle/0025_v1_agent_architecture.sql:1-31` (purpose comment, plan reference, `psql` apply line, drift detection note, marker block).
- Pre-flight `DO $$` invariant block from `0025` lines 39–48.

**Test scenarios:**
- Happy path — apply against dev DB once: all nine tables removed, exit 0.
- Edge case — apply twice: second run hits the `to_regclass IS NULL` pre-flight and `RAISE EXCEPTION`s with a clear message rather than silently no-op'ing.
- Error path — apply against a DB with any FK from a kept table that U1 missed: SQL error names the constraint, allowing operator to abort and amend.

**Verification:**
- `bash scripts/db-migrate-manual.sh --dry-run` lists the new file with 9 `-- drops:` markers detected (depends on plan 002 U5 having extended the reporter; if not yet merged, the file shows as UNVERIFIED with zero `-- creates:` markers — acceptable interim state, but the deploy gate must pass before this PR merges).
- After applying to dev: `psql -c "\dt public.*" | grep -E '(documents|principal_permission_grants|recipes|code_factory|github_app|github_webhook|workflow_configs)'` returns nothing.

---

- U3. **Drizzle schema TS deletions and barrel reconciliation**

**Goal:** Remove TS schema definitions for dropped tables (including their relations declarations), update the barrel re-exports, fix the header comment so it describes reality.

**Requirements:** R9, R11

**Dependencies:** U2 (logically — TS deletes track the migration)

**Files:**
- Delete: `packages/database-pg/src/schema/recipes.ts`
- Delete: `packages/database-pg/src/schema/code-factory.ts`
- Delete: `packages/database-pg/src/schema/workflow-configs.ts`
- Modify: `packages/database-pg/src/schema/messages.ts` — remove the `documents` table declaration at line 92 AND the `documentsRelations` declaration at line 152 AND the `// 2.4 — documents` section comment at line 89. Also drop `documents` from the file-header docstring (line 2).
- Modify: `packages/database-pg/src/schema/agents.ts` — remove the `principalPermissionGrants` table declaration starting at line 286 AND the `principalPermissionGrantsRelations` declaration starting at line 436 AND the `// 1.9 — principal_permission_grants` section comment at line 283.
- Modify: `packages/database-pg/src/schema/index.ts` — remove `recipes`, `code-factory`, `workflow-configs` re-exports; rewrite header so the cut-tables list matches actual exports.

**Approach:**
- The header currently lists `autoresearch, eval, ontology, places, workflow-configs, usage-records` as cut. Verify by grep that none of the other five names (post-removing `workflow-configs`) are silently re-exported anywhere; if any are, the header gets the same treatment.
- Header should state the post-cleanup truth: which tables were once part of v0 and are now genuinely absent from both schema and barrel.
- For each deleted relations declaration, `pnpm --filter @thinkwork/database-pg typecheck` will surface any consumer that imports the relations export — there is no schema file that imports another file's relations, so this is expected to be a no-op check.

**Patterns to follow:**
- Existing barrel file structure at `packages/database-pg/src/schema/index.ts:1-48`.

**Test scenarios:**
- Happy path — `pnpm --filter @thinkwork/database-pg build` succeeds; no TS error referencing deleted tables or relations.
- Edge case — `documentsRelations` and `principalPermissionGrantsRelations` are removed (not just the table declarations); grep confirms zero remaining matches.
- Integration — `pnpm -r --if-present typecheck` surfaces every downstream consumer that imports a deleted export.

**Verification:**
- `grep -rn "from .*schema/recipes\|from .*schema/code-factory\|from .*schema/workflow-configs" packages/database-pg/src` returns no results.
- `grep -nE 'pgTable\("(documents|principal_permission_grants)"' packages/database-pg/src/schema/` returns no matches.
- `grep -nE 'documentsRelations|principalPermissionGrantsRelations' packages/database-pg/src/schema/` returns no matches.
- `grep -nE 'export \* from "\./(autoresearch|eval|ontology|places|usage-records|workflow-configs|recipes|code-factory)"' packages/database-pg/src/schema/index.ts` returns no matches (the five pre-existing "cut" names + the three this PR removes).

---

- U4. **API: delete recipes resolvers, workflow-config resolvers, recipes GraphQL type**

**Goal:** Remove every GraphQL surface for recipes and workflow-configs.

**Requirements:** R3, R8

**Dependencies:** U3

**Files:**
- Delete: `packages/database-pg/graphql/types/recipes.graphql`
- Delete: `packages/api/src/graphql/resolvers/recipes/` (entire directory: createRecipe / updateRecipe / deleteRecipe / recipe / recipes / index)
- Delete: `packages/api/src/graphql/resolvers/orchestration/workflowConfig.query.ts`
- Delete: `packages/api/src/graphql/resolvers/orchestration/upsertWorkflowConfig.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts` (unregister recipe + workflowConfig resolvers)
- Modify: `packages/api/src/graphql/utils.ts` (one recipe-related util reference per grep — verify and delete if dead)
- Modify: `packages/api/src/__tests__/orchestration-batch3.test.ts` (remove WorkflowConfig test cases)
- Run: `pnpm schema:build` to regenerate `terraform/schema.graphql` (subscription-only schema)

**Approach:**
- Confirm `workflowConfig` resolvers have no corresponding `.graphql` field declaration (per planning); if confirmed orphaned, the resolver is wired through `resolvers/index.ts` only and the deletion is mechanical.
- After deletion, regenerate terraform AppSync schema via `pnpm schema:build`; commit the regenerated `terraform/schema.graphql`.

**Patterns to follow:**
- Resolver registration pattern in `packages/api/src/graphql/resolvers/index.ts`.

**Test scenarios:**
- Happy path — `pnpm --filter @thinkwork/api typecheck` passes; resolver registry has no dangling references.
- Happy path — `pnpm --filter @thinkwork/api test` passes after orchestration-batch3 test edits.
- Integration — `pnpm schema:build` produces a `terraform/schema.graphql` with no Recipe / WorkflowConfig types remaining.

**Verification:**
- `grep -rn "Recipe\|workflowConfig" packages/api/src` returns no live-code matches.
- `grep -n "Recipe\|WorkflowConfig" terraform/schema.graphql` returns nothing.

---

- U5. **Lambda handlers + esbuild build script**

**Goal:** Delete six Lambda handler source files and remove their build entries from `scripts/build-lambdas.sh`.

**Requirements:** R5

**Dependencies:** U4

**Files:**
- Delete: `packages/api/src/handlers/code-factory.ts`
- Delete: `packages/api/src/handlers/github-app.ts`
- Delete: `packages/api/src/handlers/github-repos.ts`
- Delete: `packages/api/src/handlers/recipe-refresh.ts`
- Delete: `packages/api/github-app-webhook.ts`
- Delete: `packages/api/github-app-callback.ts`
- Modify: `scripts/build-lambdas.sh` (remove lines 244–254 GitHub App entries, lines 289–293 recipe-refresh + code-factory entries; also grep for any handler name in the `BUNDLED_AGENTCORE_ESBUILD_FLAGS` array per CLAUDE.md guidance — none expected, verify)

**Approach:**
- Six handler deletions are atomic. The two "github-app-webhook" / "github-app-callback" handlers at `packages/api/` root (not in `src/handlers/`) are unusual — confirm their build entries point at root paths and not at moved-but-stub files before deleting.
- `wakeup-processor.ts` and `messages.ts` resolvers also matched the "recipe" grep (recipe-related code paths inside non-recipe handlers). Audit and remove only the recipe branches; do NOT delete the host handlers. Codegen regen in U6 will surface anything missed.

**Patterns to follow:**
- Handler removal precedent in `docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md` R4 (`task-connectors` entry removed).
- "Enumerated lists silently miss things" lesson from `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`.

**Test scenarios:**
- Happy path — `bash scripts/build-lambdas.sh` succeeds; no entry tries to bundle a deleted source path.
- Edge case — grep for each removed handler name across the entire script (not just deleted lines): zero hits each.
- Integration — `pnpm --filter @thinkwork/api build` produces `dist/lambdas/` with no `code-factory`, `github-app`, `github-app-webhook`, `github-app-callback`, `github-repos`, `recipe-refresh` directories.

**Verification:**
- `grep -E 'code-factory|github-app|github-repos|recipe-refresh' scripts/build-lambdas.sh` returns nothing.
- `pnpm build:lambdas` clean run succeeds.

---

- U6. **Mobile sweep (codegen-driven for recipes; explicit for code-factory)**

**Goal:** Remove every mobile UI surface that references dropped types. Recipes consumers surface via codegen failures (GraphQL-fronted); the Code Factory surface is REST-fronted and must be deleted explicitly — codegen will not catch it.

**Requirements:** R3, R4, R12

**Dependencies:** U4 (GraphQL type deletions must land first so recipe codegen surfaces the failures)

**Files:**
- Delete: `apps/mobile/app/settings/code-factory-repos.tsx` (REST-fronted, NOT surfaced by codegen — explicit delete)
- Delete: `apps/mobile/components/genui/SaveRecipeSheet.tsx`
- Modify: `apps/mobile/components/agents/agent-detail.tsx` (remove recipe section/branches)
- Modify: `apps/mobile/components/threads/ActivityTimeline.tsx` (remove recipe-related rendering)
- Modify: `apps/mobile/lib/graphql-queries.ts` (delete recipe queries/mutations — recipe queries live around line 1267+ as `gql`-tagged template literals)
- Modify: `apps/mobile/lib/gql/gql.ts`, `apps/mobile/lib/gql/graphql.ts` (regenerated by codegen — apply Allowed diff rule: deletions only)
- Modify: `apps/mobile/dist/**` (built artifacts — regenerated by next build, do not hand-edit; either delete and let next build recreate, or leave as-is and let CI regenerate)
- Run: `pnpm --filter @thinkwork/mobile codegen`

**Execution note:** Codegen-first commit, then sweep. The mobile codegen regen output should land as one commit with no other changes; subsequent commits handle each TypeScript failure surface explicitly.

**Approach:**
- Recipes path: regen codegen → typecheck → for each "Property does not exist on type" or "Cannot find name" error, locate the consuming file, delete the recipe branch, repeat.
- Code Factory path: codegen will NOT surface anything (`code-factory-repos.tsx` is REST against `POST /api/github-app/...` and `code_factory_*` endpoints, not GraphQL). Delete the screen explicitly and search Expo Router for `code-factory-repos` route refs.
- Any references in `apps/mobile/dist/_expo/static/**` are built artifacts; do not hand-edit. Let the next mobile build regenerate them.

**Patterns to follow:**
- "Allowed diff rule" from `docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md` for regenerated artifacts.

**Test scenarios:**
- Happy path — `pnpm --filter @thinkwork/mobile typecheck` passes after sweep.
- Happy path — `pnpm --filter @thinkwork/mobile build` (or Expo dev server boot) succeeds with no missing-screen / missing-import errors.
- Integration — manual smoke: open mobile app on iOS sim, navigate to Settings; no Code Factory entry; navigate to a thread; ActivityTimeline renders without a recipe section.

**Verification:**
- `grep -rn 'CodeFactory\|code_factory\|code-factory\|Recipe\|recipe' apps/mobile/app apps/mobile/components apps/mobile/lib` returns no live code matches (the `dist/` artifacts may still have stale references until next CI build — acceptable).

---

- U7. **CLI sweep**

**Goal:** Remove the `recipe` CLI command and unregister it from the CLI entry point.

**Requirements:** R3, R12

**Dependencies:** U4

**Files:**
- Delete: `apps/cli/src/commands/recipe.ts`
- Modify: `apps/cli/src/cli.ts` (unregister recipe command from commander.js setup)
- Modify: `apps/cli/src/gql/graphql.ts` (regenerated by codegen — Allowed diff rule)
- Run: `pnpm --filter thinkwork-cli codegen` (verify package name matches)

**Approach:**
- CLI command deletion is mechanical — one file delete plus one registration removal in `cli.ts`.

**Patterns to follow:**
- Existing command file pattern in `apps/cli/src/commands/`.

**Test scenarios:**
- Happy path — `cd apps/cli && pnpm dev -- --help` does not list `recipe` subcommand.
- Edge case — `pnpm dev -- recipe` returns commander.js "unknown command" error rather than crashing.
- Integration — `pnpm --filter thinkwork-cli build && pnpm --filter thinkwork-cli typecheck` passes.

**Verification:**
- `grep -n 'recipe' apps/cli/src/cli.ts` returns no live registration.
- `pnpm --filter thinkwork-cli build` succeeds.

---

- U8. **Admin codegen audit**

**Goal:** Confirm no admin SPA route or component references the dropped types; regenerate admin codegen and verify only deletions.

**Requirements:** R12

**Dependencies:** U4

**Files:**
- Modify: `apps/admin/src/gql/graphql.ts` (regenerated by codegen — Allowed diff rule)
- Run: `pnpm --filter @thinkwork/admin codegen`

**Approach:**
- Per pre-planning grep, `apps/admin/src/routes/_authed/_tenant/` and `apps/admin/src/components/Sidebar.tsx` reference none of the dropped types. After codegen, the `gql/graphql.ts` diff should contain only deletions referencing `Recipe`, `CodeFactory*`, `GithubApp*`, `WorkflowConfig*`. Anything else in the diff is a stop-the-line signal.
- If codegen regen surfaces any TypeScript error in admin, locate and remove the dead reference (likely a test fixture or unused hook).

**Patterns to follow:**
- "Allowed diff rule" pattern.

**Test scenarios:**
- Happy path — `pnpm --filter @thinkwork/admin typecheck` and `pnpm --filter @thinkwork/admin build` both succeed.
- Integration — admin dev server boots on `:5174`, all existing routes load without console errors.

**Verification:**
- `git diff apps/admin/src/gql/graphql.ts` shows only deletions referencing dropped types; no additions or modifications.

---

- U9. **Terraform: GitHub App de-provisioning**

**Goal:** Remove API Gateway routes, Lambda function references, Secrets Manager private key, and IAM policy entries for the GitHub App and recipe-refresh.

**Requirements:** R6

**Dependencies:** U5 (Lambda source must be gone first so terraform destroy doesn't conflict)

**Files:**
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (remove `github-app`, `github-repos`, `recipe-refresh` entries from Lambda function list and API Gateway routes — `POST /api/recipe-refresh`, `ANY /api/github-app/{proxy+}`, `POST /api/github/webhook`)
- Modify: any other terraform file in `terraform/modules/` that provisions the GitHub App private key in Secrets Manager (e.g., `secrets.tf` or similar — enumerate during implementation)
- Modify: any IAM policy file granting access to that secret (`iam.tf` or similar)

**Approach:**
- Step 1: Search `terraform/` for `github_app`, `github-app`, `code_factory` to enumerate every resource. Pre-planning grep returned only `terraform/modules/app/lambda-api/handlers.tf`, but resources may live in other modules (e.g., the `data` module for secrets, the `foundation` module for IAM).
- Step 2: Run `terraform plan -s dev` after edits; review the destroy list. Expected: 3 Lambda functions, 3 API Gateway routes (or method/integration triplets), 1 Secrets Manager secret, 1+ IAM policy attachments. If the plan shows anything unrelated, stop.
- Step 3: PR description includes the full `terraform plan` output for reviewer audit.
- Step 4: Operator runbook for GitHub App un-registration (if U1 found active installations): document the order — revoke each tenant installation via GitHub UI → delete the App registration → `terraform apply` → verify with `aws secretsmanager list-secrets` and `aws lambda list-functions`.

**Patterns to follow:**
- The Connectors plan's terraform-removal pattern (commit `81406b5` referenced in `docs/brainstorms/2026-04-20-remove-admin-connectors-requirements.md`).

**Test scenarios:**
- Happy path — `cd apps/cli && pnpm dev -- plan -s dev` (or `terraform plan` directly in the relevant module) shows only destruction of GitHub-App-related resources and recipe-refresh Lambda. Zero non-related changes.
- Integration — after `thinkwork deploy -s dev`: `aws apigatewayv2 get-routes --api-id <dev-api-id> | grep github-app` returns nothing; `aws lambda list-functions | grep -E '(github-app|recipe-refresh|github-repos)'` returns nothing.

**Verification:**
- `grep -rn "github_app\|github-app\|code_factory\|recipe-refresh" terraform/` returns no live resource declarations (historical references in `docs/plans/archived/` are acceptable but not in `terraform/`).

---

- U10. **Docs sweep**

**Goal:** Remove documentation pages describing Code Factory or the GitHub App as a product capability; remove cross-references and nav entries.

**Requirements:** R7

**Dependencies:** U5 (logically — docs should describe the post-cleanup state)

**Files:**
- Delete: any `docs/src/content/docs/**/*.md{,x}` page describing Code Factory or the GitHub App as a product capability (enumerate during implementation — likely under `docs/src/content/docs/concepts/` or `docs/src/content/docs/integrations/`)
- Modify: `docs/astro.config.mjs` (remove deleted pages from sidebar nav)
- Modify: any cross-referencing page (architecture overview, integrations index, applications/admin/index) that links to the removed pages

**Approach:**
- Mirror the Connectors plan's docs sweep pattern (`docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md` R6–R8): enumerate every link site, delete the leaf pages first, then update each parent page to remove the broken link, then verify Astro build is clean.
- `docs/dist/` regenerates on next CI publish; no manual deletion required.

**Patterns to follow:**
- Connectors plan R6–R8 docs cleanup discipline.

**Test scenarios:**
- Happy path — `pnpm --filter @thinkwork/docs build` (or whatever the Astro build command is) succeeds with no broken-link warnings.
- Integration — local docs site preview renders with no 404 entries in nav.

**Verification:**
- `grep -rn 'Code Factory\|code-factory\|github.app\|GitHub App' docs/src/content/docs/` returns no live page matches (historical mentions in changelogs are fine).
- `pnpm build` succeeds across the monorepo.

---

## System-Wide Impact

- **Interaction graph:** Removed Lambdas (`github-app`, `github-repos`, `recipe-refresh`) had API Gateway routes attached. After U9 the routes 404; pre-existing customer-side webhook clients (if any) get 404s — same behavior the Connectors plan accepted. The `wakeup-processor` and `messages` handlers had grep hits for "recipe" but are NOT dropped — U5 requires removing only the recipe branches inside them.
- **Error propagation:** A partial deploy (TS deletions land but migration doesn't apply) means runtime resolvers reference dropped tables — Postgres errors propagate as GraphQL 500s. Mitigation: U2 migration applies via the `psql -f` step *before* the Lambda code update; the `db:migrate-manual` reporter (extended by plan 002 U5 to recognize `-- drops:` markers) gates the deploy.
- **State lifecycle risks:** Dropping `code_factory_repos` removes the GitHub App's installation/repo association table. If U1 finds active installations, U9's terraform destroy must be sequenced after manual GitHub-side revocation, otherwise GitHub will keep retrying webhook deliveries against a 404 endpoint until back-off. Brainstorm assumes no production installations; U1 verifies.
- **API surface parity:** GraphQL: only `recipes` types disappear. AppSync subscription schema: regenerated by `pnpm schema:build` in U4 — the diff should show only Recipe/WorkflowConfig deletions.
- **Integration coverage:** Codegen regeneration in U6/U7/U8 surfaces dead consumers structurally rather than via runtime errors. The "Allowed diff rule" on each generated artifact catches drift the human eye would miss.
- **Unchanged invariants:** The OAuth GitHub connector (under `connect_providers`/`connections`/`credentials`) is explicitly preserved — see brainstorm Scope Boundaries. The plan must not touch any code path that handles GitHub OAuth tokens for per-user MCP/connector flows. The `tenants.disabled_builtin_tools` JSONB column from `0025_v1_agent_architecture.sql` is unaffected. Wiki, evals, scheduling, billing, and skill-runs surfaces are untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Plan 002's `-- drops:` reporter extension hasn't merged when this PR is ready | Coordinate merge order — plan 002 merges first OR co-ships with this PR. If plan 002 slips, the U2 migration's `-- drops:` markers report as UNVERIFIED in the deploy gate (zero `-- creates:` markers parsed) — interim state is acceptable but the deploy gate must pass before merge. |
| Migration ordinal `0028` collides with a fourth concurrent plan that hasn't been spotted | Rare but possible. Pre-merge, re-grep `docs/plans/2026-04-24-*.md` for `0028` and bump if needed. |
| GitHub App has active production installations U1 didn't find | U1 explicitly checks via `gh api /app/installations`. If found, U9's runbook adds a manual installation-revocation step before `terraform apply`. |
| Codegen regen surfaces unexpected admin consumer that wasn't in pre-planning grep | U8's "Allowed diff rule" catches it — additions or modifications in the diff are a stop-the-line signal. Implementer pauses, locates the consumer, removes the dead branch. |
| Terraform destroy plan includes unrelated resources (state drift) | U9 explicit step: review the destroy list before `terraform apply`. If anything unrelated appears, stop and reconcile state separately. |
| `wakeup-processor.ts` and `messages.ts` had recipe grep hits — partial dependency may exist that's not just a comment | U5 requires audit of those files specifically; do NOT delete the host handlers. Codegen regen will surface any TS-level dependency. |
| Mobile `dist/` artifacts retain references to deleted types | Acceptable — `dist/` regenerates on next build. Worth a one-line PR-description note so reviewers don't flag it. |
| Code Factory mobile screen (`code-factory-repos.tsx`) is REST, not GraphQL — codegen will not surface it as broken | U6 lists the file under explicit deletes (not codegen-driven). Verification step grep catches it independently of codegen. |

---

## Documentation / Operational Notes

- PR description includes:
  - U1 row-count verification output (every dropped table + every FK referrer + GitHub App installation list)
  - U2 migration `\d+` evidence after dev apply (per the manually-applied migrations runbook)
  - U9 `terraform plan` output before apply
  - Operator runbook for GitHub App un-registration (if U1 found installations)
- After merge: open `/ce-compound` capture session to record (a) GitHub App de-provisioning runbook template, (b) codegen regen as dead-caller finder. These two lessons are flagged in the learnings doc as gaps with no prior solutions entry. (The "first DROP migration" framing was incorrect — `0016_wiki_schema_drops.sql` is the real precedent.)
- Deploy via the normal pipeline. No special manual steps beyond the `psql -f` apply that all manually-applied migrations require — the `db-migrate-manual` reporter (now extended) gates the deploy automatically.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-24-pre-launch-db-schema-cleanup-requirements.md`
- Related plan (precedent for shape): `docs/plans/2026-04-20-009-refactor-remove-admin-connectors-plan.md`
- Concurrent plans (resolved): `docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md` takes migration `0026`; `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` takes `0027` AND owns the `-- drops:` reporter extension that this plan depends on.
- Drift reporter source: `scripts/db-migrate-manual.sh`
- Manually-applied migrations gotcha: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Pre-flight discipline: `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
- Multi-surface retire runbook: `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md`
- Enumerated-list drift (build script lesson): `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`
