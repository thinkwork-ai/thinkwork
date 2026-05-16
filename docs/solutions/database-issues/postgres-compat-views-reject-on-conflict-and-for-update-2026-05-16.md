---
title: Postgres compat views reject ON CONFLICT and FOR UPDATE — limits the read-only deploy bridge for live-table schema moves
module: packages/database-pg, packages/api/src/lib/wiki, packages/api/src/lib/brain
date: 2026-05-16
problem_type: database_issue
component: database
severity: high
symptoms:
  - "ERROR: ON CONFLICT DO UPDATE not supported on updatable views"
  - "ERROR: cannot lock rows in view"
  - "Old bundled Lambda code fails at runtime after a SET SCHEMA migration applies, even when compat views were created to bridge old→new names"
  - "wiki-compile fails to enqueue or advance its cursor through the public.wiki_compile_jobs view during the deploy bridge window"
root_cause: wrong_api
resolution_type: workflow_improvement
related_components:
  - migration_workflow
  - drift_gate
  - deploy_pipeline
tags:
  - postgres
  - schema-extraction
  - compat-views
  - deploy-bridge
  - on-conflict
  - for-update
  - instead-of-triggers
related:
  - docs/solutions/database-issues/feature-schema-extraction-pattern.md
  - docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md
  - docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
---

# Postgres compat views reject ON CONFLICT and FOR UPDATE

## Problem

When you extract live populated tables into a new Postgres schema (e.g., `public.wiki_pages` → `wiki.pages`), the standard bridge pattern is to leave a compat view in `public.*` aliasing the new location so old Lambda bundles can keep reading during the brief deploy window between `psql -f` apply and Lambda redeploy completion. The view layer transparently routes simple reads and writes through to the underlying schema-qualified table.

**The bridge breaks for writes that use `INSERT ... ON CONFLICT` or `SELECT ... FOR UPDATE`.** Postgres rejects both at parse time before any data flow happens, and there's no trigger workaround. For Drizzle code that uses `.onConflictDoNothing()` / `.onConflictDoUpdate()` (compile-job queues, dedupe-keyed inserts, cursor upserts) or hand-written `FOR UPDATE SKIP LOCKED` queue claims, every old bundled Lambda that hits the view during the deploy window will fail until its zip is redeployed with the new schema-qualified source.

This was discovered during PR review of the wiki+brain schema extraction arc (#1251 / #1259 / #1264) before any production damage. PR review surfaced the limitation; the team chose operational discipline (briefly pause the affected EventBridge schedules during the deploy window) rather than mid-flight design changes to the migration.

## Symptoms

- Postgres parse-time errors during INSERT/SELECT through a compat view:
  - `ERROR: ON CONFLICT DO UPDATE not supported on updatable views`
  - `ERROR: ON CONFLICT DO NOTHING not supported on updatable views`
  - `ERROR: cannot lock rows in view "<view_name>"`
- Drizzle `.onConflictDoNothing({ target: ... })` / `.onConflictDoUpdate({...})` calls failing through the compat view.
- Hand-written `SELECT ... FROM public.<table> ... FOR UPDATE [SKIP LOCKED]` failing through the compat view.
- Job-queue claim loops returning empty / silently failing because the FOR UPDATE clause can't execute.
- Cursor advance writes silently failing — next invocation reprocesses the whole window because the cursor never moved.
- Symptom is bounded to the deploy bridge window: it starts when `psql -f` applies on prod and ends when terraform-apply finishes redeploying bundled Lambdas with the new Drizzle source.

## What Didn't Work

**INSTEAD OF triggers** — the first instinct is to add `INSTEAD OF INSERT/UPDATE/DELETE` triggers to each compat view, routing writes (including `ON CONFLICT` semantics) to the underlying schema-qualified table. This **does not work**: Postgres rejects `INSERT ... ON CONFLICT` against a view at *parse time*, before any trigger has a chance to fire. The same applies to `FOR UPDATE` — the planner rejects the row-lock request on a view before reaching execution. From the Postgres docs: "The INSERT statement supports ON CONFLICT, but this clause is not allowed with INSERT INTO view." There's no escape hatch via triggers.

**Scoping compat views to only the read-heavy tables** — e.g., drop the view for `wiki_compile_jobs` / `wiki_compile_cursors` since they're write-heavy. Doesn't help: old bundled Lambdas still query `public.wiki_compile_jobs` directly (because the OLD Drizzle source they were built against resolves to `public.<table>`). Without the view, the queries fail with "relation does not exist" *immediately* after the migration applies — worse than failing only on ON CONFLICT writes.

**Sequencing the deploy to ship new Lambda bundles BEFORE `psql -f` apply** — the intuition is to put new code in place first so it queries the new schema directly, then apply the migration. Doesn't work either: new Lambda bundles built against the new Drizzle source try to query `wiki.pages`/`brain.pages` against a DB that doesn't yet have those schemas — Postgres returns `relation does not exist`. The migration apply is a *precondition* for the new code, not something that can chase it.

**Atomic Lambda alias swap + migration** — theoretically you could pre-build the new Lambda versions, apply the migration, then atomically swap aliases. AWS Lambda doesn't offer atomic cross-function alias swaps, and terraform-apply runs sequentially, so the window remains nonzero.

## Solution

**Accept a brief outage on ON CONFLICT / FOR UPDATE paths during the deploy bridge window. Pause schedule-driven writes for the duration of the window.** The compat views still protect reads cleanly; only the write paths that use those specific SQL features fail.

Operational runbook (used by the wiki+brain arc; included in PR #1251's body):

```bash
# 1. Disable schedule-driven writes that use ON CONFLICT.
aws events disable-rule --name thinkwork-prod-wiki-compile-schedule --region us-east-1

# 2. Apply the migration to prod.
psql "$DATABASE_URL" -f packages/database-pg/drizzle/0089_wiki_schema_extraction.sql

# 3. Merge the PR. Post-merge terraform-apply redeploys bundled Lambdas
#    with the new Drizzle source, which queries wiki.* directly.
#    Wait 3-8 min for the deploy to complete.

# 4. Verify the redeploy:
aws lambda get-function-configuration \
  --function-name thinkwork-prod-wiki-compile \
  --query 'LastModified' --output text

# 5. Re-enable the schedule.
aws events enable-rule --name thinkwork-prod-wiki-compile-schedule --region us-east-1
```

During steps 2-4, the following user-triggered or schedule-driven endpoints will fail:
- `compileWikiNow` GraphQL mutation (admin-triggered)
- `bootstrap-journal-import` Lambda (admin-triggered; don't run during the window)
- Maintenance scripts that write via ON CONFLICT (e.g., `wiki-link-backfill.ts`)

Reads continue working throughout the window via the compat views — mobile/admin wiki browsing, search, graph rendering all stay healthy.

## Why This Works

The compat-view bridge was always a *read*-bridge. The original design assumption was that old code's writes would also pass through, but Postgres's parse-time rejection of ON CONFLICT-against-view breaks that assumption for any ORM or hand-rolled SQL that uses conflict resolution or row locking. Reads still pass cleanly because views support plain `SELECT`, `JOIN`, `WHERE`, and `ORDER BY` without restriction.

The brief-outage approach exploits the structure of the affected code paths: nearly all ON CONFLICT writes in the wiki/brain feature surface are either schedule-driven (EventBridge-paced compile loop) or admin-triggered (one-shot mutations). Pausing the schedule + holding the admin actions for the duration of `terraform apply` (typically 3-8 minutes) costs nothing in user-visible time because nobody is actively triggering those flows during the window. The read paths — which DO have user-visible traffic — keep working through the views.

The total user-visible impact is zero on the read side and bounded to the operator-aware paused-schedule window on the write side.

## Prevention

When designing a compat-view bridge for live-table schema moves:

1. **Inventory the write paths before authoring the migration.** Grep for `.onConflictDoNothing` / `.onConflictDoUpdate` / `FOR UPDATE` / `FOR SHARE` against the moving tables. Anything you find in old bundled Lambda code will fail through the bridge. The wiki+brain arc found 9+ ON CONFLICT writes across `wiki.pages`, `wiki.page_aliases`, `wiki.page_links`, `wiki.compile_jobs`, `wiki.compile_cursors`, etc.
2. **Categorize the writes:**
   - **User-blocking, real-time** (e.g., a user mutation that needs ON CONFLICT for idempotency) → cannot pause; must redesign the bridge or accept a maintenance window
   - **Schedule-driven or admin-triggered** → pause the schedule, hold admin actions, accept brief outage on those paths
3. **Author the runbook in the PR body, not after the fact.** Operator should know before merge exactly which EventBridge rules to disable, in what order, with what AWS CLI commands.
4. **Document the limitation in the pattern doc** so the next schema extraction doesn't re-discover it (see `docs/solutions/database-issues/feature-schema-extraction-pattern.md`, which now references this learning).
5. **Don't try to "fix" the view layer with INSTEAD OF triggers.** This is the single most likely waste of time during the design phase — the triggers don't fire, because Postgres rejects at parse time. Save the cycles.
6. **For drift gates added in the same PR as the first migration that uses the bridge**, scope the gate to PR-changed files only so pre-existing drift on unrelated migrations doesn't surface as MISSING and block merge (related: the migration-precheck workflow now passes only PR-diff-changed `.sql` files to `scripts/db-migrate-manual.sh` via positional args — see PR #1251 commits `e4b51e1e` and `9af72c41`).

When applying the bridge:
- Always disable affected schedules **before** the prod `psql -f`. Re-enabling after the deploy completes is harmless; leaving them running during the window is what causes the visible outage.
- Apply to dev first, validate the gate scoped to your new migration is green, then apply to prod immediately before merge so the redeploy starts right away.
- The deploy bridge window starts when `psql -f` commits and ends when bundled-Lambda `LastModified` shows a fresh timestamp. Watch the deploy run via `gh run watch` or `aws lambda get-function-configuration` polling.
