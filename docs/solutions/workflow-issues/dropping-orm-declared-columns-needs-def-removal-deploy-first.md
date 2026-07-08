---
title: Dropping an ORM-declared column needs the schema-def-removal deploy live before the DROP
date: 2026-07-04
category: workflow-issues
module: packages/database-pg/drizzle
problem_type: workflow_issue
component: database
severity: high
related_components:
  - development_workflow
  - tooling
applies_when:
  - "A destructive migration DROPs a column or table that the deployed Drizzle schema still declares in a pgTable() definition"
  - "Splitting a judge/evidence/feature removal into a code-removal PR followed by a destructive DROP migration"
  - "Applying a hand-rolled `-- drops:` migration to dev via psql on the continuously-deployed-from-main stack"
  - "Deciding whether to hand-apply a drop migration to a customer stage ahead of that stage's code deploy"
tags:
  - drizzle
  - migrations
  - destructive-migration
  - expand-contract
  - deploy-ordering
  - schema-drop
---

# Dropping an ORM-declared column needs the schema-def-removal deploy live before the DROP

## Context

This stack pairs Drizzle ORM with hand-rolled Postgres migrations and continuous CD from `main` (dev redeploys on every merge). Additive hand-rolled migrations follow a well-known rule: apply the SQL to dev via psql **before** merge so the drift gate (`db:migrate-manual`) sees the objects present. Destructive migrations behave the **opposite** way, and getting that backwards took dev's Automations surface down mid-session (THINK-137 U10).

Drizzle's `db.select().from(table)` (no explicit column list), `.returning()`, and most full-row reads emit **every column declared in the `pgTable()` definition**. So the deployed Lambda's ORM schema and the actual DB schema must agree: a column that has been dropped from the DB but is still *declared* in the deployed code makes **every** full-row query on that table fail with `column "X" does not exist` — not just the mutation you were testing. On `agent_loops` that meant list, detail, manual dispatch, and webhook dispatch all 500'd at once, from a single premature `DROP COLUMN`.

## Guidance

Treat a destructive migration that drops an ORM-declared column/table as **expand/contract**, and never pre-apply it to dev the way you would an additive migration:

1. **PR A — code removal + relaxation.** Remove every reader/writer of the target from code. If the drop targets are `NOT NULL` columns the write path still sets, add a small migration that makes them nullable so the write-stop is legal. **Keep the Drizzle `pgTable()` column/table definitions in place** — the ORM may still declare them; that is harmless while the columns exist. Deploy and verify.
2. **PR B — remove the Drizzle definitions (code) and DROP (migration).** This PR deletes the `pgTable()` column/table defs so the deployed ORM stops emitting them, *and* carries the hand-rolled `-- drops:` migration.
3. **Ship PR B's code first, then drop.** Let PR B merge and its Deploy run go green so the column-less Drizzle schema is live. **Only then** apply the DROP migration to dev via psql. The drop is now invisible to the running code because it no longer declares the columns.

Do **not** apply a `-- drops:` migration to dev before its def-removal PR deploys. And do **not** hand-apply drop migrations to a **customer** production DB ahead of that stage's code — the customer deploy runner applies migrations *with* the matching code on release, which is the same expand/contract ordering done safely.

Gate facts that make step 3 possible (verified 2026-07): the PR-level **"Migration Precheck (dev)"** check is **not** a required status check (required set: `lint`, `typecheck`, `test`, `verify`, `cla`), and `deploy.yml`'s `migration-drift-check` job is **temporarily disabled**. So a `-- drops:` marker reading `STILL_PRESENT` (drift reporter exit 1, because you correctly have *not* dropped yet) does **not** block merge or deploy. If either gate is re-enabled later, the drift reporter's `STILL_PRESENT`-on-drops behavior will need reconciling with this ordering.

## Why This Matters

The failure mode is broad and silent until it isn't: the migration "succeeds" (the DROP runs fine), but the still-deployed code's next full-row `SELECT`/`INSERT`/`RETURNING` throws `column "X" does not exist`, taking down every path that touches that table. Because additive migrations train you to "apply to dev before merge," it is easy to apply a drop the same way and break the live app in the window before the def-removal deploys. The recovery is fast but only if you recognize the signature immediately.

The same law is why hand-applying a drop to a zero-data customer stage "to close a checklist item" is actively dangerous: the customer's deployed (older) code still declares the columns, so the drop reproduces this outage on the customer. The runner's release-time apply — code and migrations together, in order — is the correct mechanism, not a manual psql.

## When to Apply

- Any hand-rolled migration that `DROP`s a column or table (or drops a `NOT NULL`/default that terraform/ORM still relies on).
- Deciding the PR split for a feature removal that ends in a schema drop.
- Weighing whether to hand-apply a drop migration to dev or a customer stage.
- The inverse (additive: `ADD COLUMN`, backfill, widen CHECK) does **not** apply here — apply those to dev via psql *before* merge for the drift gate, as usual.

## Examples

**The incident (THINK-137 U10, 2026-07-04).** Migration `0214` dropped `agent_loops` ROI columns + `agent_loop_versions.judge_spec/evidence_policy` + the judgments/evidence tables. It was applied to dev via psql while PR-A's code — which still declared those columns in the Drizzle `pgTable()` — was the live deploy. Result, straight from the `graphql-http` logs:

```
ERROR  error: column "accepted_run_count" of relation "agent_loops" does not exist
```

`saveAgentLoop`, the automations list, dispatch, and webhook dispatch all failed — not just create.

**Recovery (heal the live code first, then re-sequence):**

```sql
-- Re-add the dropped columns with their ORIGINAL types/defaults/nullability so the
-- still-deployed ORM's full-row queries work again. Heals dev in seconds.
ALTER TABLE public.agent_loops
  ADD COLUMN IF NOT EXISTS accepted_run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated_run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_usd_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_accepted_run_usd_cents bigint;
ALTER TABLE public.agent_loop_versions
  ADD COLUMN IF NOT EXISTS judge_spec jsonb,
  ADD COLUMN IF NOT EXISTS evidence_policy jsonb;
```

**Correct ordering (what shipped):** merge PR B (removes the Drizzle defs + carries `0214`), let its Deploy go green so the column-less ORM is live, **then** apply `0214` to dev. Post-drop, `saveAgentLoop` created with `judge_spec` NULL (proving the write path stopped touching it), dispatch queued, and the full-row automations list returned — no `column does not exist`. On the customer stages (TEI, McPherson) the deploy runner applied `0210–0214` in order *with* the matching v315 code, so the drop landed safely there without any manual psql.

## Related

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — the drift *detection* side (marker convention + `db:migrate-manual`); this doc is the drop-*ordering* side.
- The additive counterpart and the general destructive-after-code-removal-deploy rule live in the project's migration-ordering conventions (apply additive to dev before merge; destructive only after the code-removal deploy).
