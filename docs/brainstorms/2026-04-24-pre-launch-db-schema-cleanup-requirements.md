---
date: 2026-04-24
topic: pre-launch-db-schema-cleanup
---

# Pre-Launch Database Schema Cleanup

## Problem Frame

The `public` schema in Aurora has accumulated v0-era tables that no longer correspond to v1 product capabilities — some are dead-on-arrival (no callers), some are v0 abstractions superseded by v1 skills, and one is on a parked feature line. Carrying this surface into launch costs in three ways: GraphQL/admin code stays wired to retired concepts (drag on every refactor), the schema stops being a self-describing source of truth (`packages/database-pg/src/schema/index.ts:1-7` already lists `workflow-configs` as cut while still re-exporting it), and an enterprise tenant inspecting the schema would see capabilities the product does not deliver.

This brainstorm consolidates the cleanup so it ships as a coherent batch instead of accreting as ad-hoc removals during other PRs. It explicitly **defers** the threads-area cleanup that already lives in the in-flight `2026-04-24-thread-detail-cleanup` brainstorm — that work is not duplicated here.

---

## Requirements

**Drop dead tables (no callers anywhere in the monorepo)**
- R1. Drop the `documents` table from `packages/database-pg/src/schema/messages.ts`. No GraphQL type, no resolver, no UI surface references it; the 300+ "documents" string matches in the repo are S3-prefix paths, not table reads.
- R2. Drop the `principal_permission_grants` table from `packages/database-pg/src/schema/agents.ts`. The table is declared and locally exported but never re-exported from `index.ts` and never imported by any consumer. The user previously called the name "awful" — the rename question is moot once it's removed.

**Drop v0 abstractions superseded by v1 skills**
- R3. Drop the `recipes` table and remove every consumer: `packages/database-pg/src/schema/recipes.ts`, `Recipe` / `RecipeInput` GraphQL types, `recipes` query and `createRecipe` / `updateRecipe` / `deleteRecipe` mutation resolvers, any admin or mobile screen that reads them. v1 commits to skills (SKILL.md bundles) as the single user-facing "saved capability" abstraction; recipes were the v0 form of the same idea.

**Drop the parked Code Factory feature**
- R4. Drop the five Code Factory tables: `code_factory_repos`, `code_factory_jobs`, `code_factory_runs`, `github_app_installations`, `github_webhook_deliveries`.
- R5. Remove the GraphQL surface and resolvers in `packages/api/src/graphql/code-factory.ts` and `packages/api/src/graphql/github-app.ts` (and any `code-factory.graphql` / `github-app.graphql` type files).
- R6. Remove the GitHub App webhook Lambda handler and its build entry in `scripts/build-lambdas.sh`.
- R7. Remove or de-provision the GitHub App terraform (private key in Secrets Manager / SSM, App registration outputs, IAM policy entries) so the cleanup is also visible at the infra layer.
- R8. Sweep documentation: any `docs/src/content/docs/**` page that describes Code Factory or the GitHub App as a product capability is removed; cross-references in nav and overview pages updated.

**Drop the parked composition orchestrator config**
- R9. Drop the `workflow_configs` table and its `packages/database-pg/src/schema/workflow-configs.ts` definition. Remove `upsertWorkflowConfig` and `workflowConfig` resolvers and any admin UI that reads them. The v1 architecture brainstorm explicitly retired the composition runner (R6 of `2026-04-23-v1-agent-architecture-final-call-requirements.md`); this table is its config layer.

**Fix schema barrel inconsistency**
- R10. Reconcile `packages/database-pg/src/schema/index.ts`. The header (lines 1–7) declares `autoresearch`, `eval`, `ontology`, `places`, `workflow-configs`, `usage-records` as cut/out-of-scope, but `workflow-configs` is still re-exported on line 35. Remove that re-export (resolved by R9) and verify the other five names are not silently re-exported from anywhere else; rewrite the header comment so it accurately describes the post-cleanup state.

**Migration mechanics**
- R11. Drops ship as a single new migration (likely `0026_pre_launch_cleanup.sql`) rather than scattered across PRs. Use the hand-rolled `.sql` convention with `-- creates: …` / `-- drops: …` markers so `pnpm db:migrate-manual` can verify the drift. Foreign-key drops sequenced before owning-table drops to avoid `NO ACTION` blocks.
- R12. Schema TypeScript exports (`index.ts` and the deleted files' direct importers) updated in the same PR as the migration so the deploy can't land in a half-state where TS still references a dropped table.

**Codegen and downstream sweeps**
- R13. Regenerate GraphQL codegen in every consumer that imports any removed type: `packages/api`, `apps/admin`, `apps/mobile`, `apps/cli`. Remove dead UI screens, hooks, and route entries surfaced by codegen failures rather than via a separate manual sweep.

---

## Success Criteria

- Querying `information_schema.tables` for the `public` schema after the migration deploys returns zero rows for any of the dropped table names.
- `grep -rEi 'documents|principal_permission_grants|recipes|code_factory|githubAppInstallations|workflowConfigs'` across `apps/`, `packages/`, `scripts/`, `terraform/`, and `docs/src/` returns no live-code matches (historical hits in `docs/plans/archived/` and brainstorm history are acceptable).
- `pnpm -r --if-present typecheck` and `pnpm -r --if-present build` succeed after codegen regeneration; no consumer references a removed type.
- `packages/database-pg/src/schema/index.ts` header matches reality — every name in the "cut tables" list is genuinely not exported from the barrel, and `workflow-configs` is no longer re-exported.
- A downstream implementer can execute the cleanup from this doc plus the resulting `/ce-plan` without re-litigating which tables go and which stay.

---

## Scope Boundaries

- **Out of scope: threads-area cleanup.** `thread_comments`, `thread_attachments`, `message_artifacts`, `threads.parent_id`, `threads.status` / `priority` / `type`, and the `threads` shape changes are owned by `2026-04-24-thread-detail-cleanup`. This brainstorm does not duplicate that work.
- **Out of scope: thread_label_assignments.** Labels are a real control-plane organizing concept independent of the task-tracker era and remain in v1.
- **Out of scope: connect_providers, connections, credentials.** OAuth + MCP foundation; explicitly preserved by the `2026-04-20-remove-admin-connectors` brainstorm.
- **Out of scope: webhook_idempotency, mutation_idempotency, retry_queue, webhook_deliveries.** Correctness/operational primitives that v1 features actively depend on.
- **Out of scope: quick_actions.** User confirmed during this brainstorm that `user_quick_actions` is reserved for an upcoming mobile feature; do not drop.
- **Out of scope: row-level data deletes from kept tables.** No `DELETE FROM` runs as part of this cleanup; tables are either dropped wholesale (via the migration) or untouched.
- **Out of scope: knowledge_bases, teams, guardrails, inbox_items, email_reply_tokens.** Their v1 status is uncertain but the user did not authorize cutting them in this pass — they remain candidates for a follow-up audit, not this PR.

---

## Key Decisions

- **`thread_dependencies` folds into `thread-detail-cleanup`, not this brainstorm.** It is the same task-tracker era concept as `threads.parent_id`, which `thread-detail-cleanup` R2 already removes; bundling the migration with that PR keeps the threads cleanup atomic and prevents two migrations both touching `threads`-related FKs.
- **GitHub App tables are part of Code Factory, not the GitHub OAuth connector.** The OAuth-side `connect_providers`/`connections` rows for GitHub remain (per the connector keep-list); only the App-installation infra used by Code Factory is removed.
- **No deprecation period.** Each table being dropped either has zero callers or is on a feature surface that v1 does not ship; a deprecation banner serves no audience.
- **Single migration, not per-feature migrations.** Aurora drops are cheap, the surface area is small, and bundling reduces deploy ceremony — but each `-- drops:` marker stays explicit so the manual-migration drift reporter can audit each one.
- **Code Factory is dropped, not parked-with-tables-kept.** Keeping the schema "in case we revive it" preserves the same drag this brainstorm exists to remove. If the feature returns, it returns with a fresh schema designed for v1+ shape.

---

## Dependencies / Assumptions

- Assumes no production tenant has rows in `documents`, `principal_permission_grants`, `recipes`, `code_factory_*`, `github_app_installations`, `github_webhook_deliveries`, or `workflow_configs` whose loss would cause a customer-visible regression. Pre-migration row-count check is a planning task.
- Assumes the Code Factory GitHub App is not currently installed on any production GitHub organization. If it is, R7 needs to coordinate App uninstallation with GitHub before removing the Lambda webhook receiver, otherwise GitHub will retry deliveries against a 404.
- Assumes `quick_actions` will materially differ from `recipes` once the upcoming mobile feature lands; if the upcoming feature collapses back into "user-saved tool invocations," revisit whether quick_actions should also retire to skills.
- Assumes `2026-04-24-thread-detail-cleanup` ships before, after, or parallel to this — but not in conflict. Both touch different tables; the only coordination cost is the migration number.

---

## Outstanding Questions

### Resolve Before Planning

(none — proceed to `/ce-plan`)

### Deferred to Planning

- [Affects R7][Technical] Verify whether the Code Factory GitHub App is currently installed on any production org and whether the App registration itself should be deleted from GitHub (vs. just decoupled from this codebase). Coordinate uninstall with any active install before removing the webhook receiver.
- [Affects R11][Technical] Foreign-key dependency order for the Code Factory drops — `code_factory_runs` references `code_factory_jobs` references `code_factory_repos`; `github_webhook_deliveries` and `github_app_installations` have their own FK shape. Enumerate during planning.
- [Affects R3, R9][Needs research] Full call-site enumeration of `Recipe*` and `WorkflowConfig*` GraphQL types across `apps/admin`, `apps/mobile`, and `apps/cli` so codegen failures are not the only signal.
- [Affects R13][Technical] Whether the deploy pipeline's pre-deploy `pnpm db:migrate-manual` reporter correctly handles drops (today it verifies `creates:`; the convention for `drops:` may need a small reporter extension or a doc-only convention).

### Follow-up audit candidates (not blocking)

- Audit the v1 status of `knowledge_bases` + `agent_knowledge_bases`, `teams` + `team_agents` + `team_users`, `guardrails` + `guardrail_blocks`, `inbox_items` + `inbox_item_comments` + `inbox_item_links`, and `email_reply_tokens`. Each has callers but no v1 brainstorm naming it as v1. Worth a focused brainstorm post-launch, not pre-launch.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
