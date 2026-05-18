---
title: Feature-schema extraction pattern for live Postgres tables
date: 2026-05-16
category: database-issues
module: "packages/database-pg, packages/api"
problem_type: pattern
component: database
severity: high
applies_when:
  - "A feature cluster has 5+ tables in `public.*` and a coherent module boundary in `packages/api/src/lib/<feature>/`"
  - "The tables are populated with production data (not greenfield)"
  - "Operator-facing namespace clarity matters (psql `\\dt`, BI tools, backups, dumps see fifteen prefixed tables crowding `public`)"
  - "Naming has accumulated redundancy because `public.*` is the shared namespace (e.g., `public.wiki_pages`, `public.tenant_entity_pages`)"
related_components:
  - drift_reporter
  - hand_rolled_migrations
  - codegen_workflow
references:
  - docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
  - docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md
  - packages/database-pg/drizzle/0069_compliance_schema.sql
  - packages/database-pg/src/schema/compliance.ts
---

# Feature-Schema Extraction Pattern

Extract a feature cluster of live Postgres tables out of `public.*` into a dedicated schema (`<feature>.*`) without taking a production outage, using hand-rolled SQL migrations, Drizzle `pgSchema(...)` source, and a compatibility-view bridge.

The `compliance` schema (migration 0069) established the *greenfield* `pgSchema(...)` pattern. This pattern extends it to **live, populated tables with non-trivial consumer surface** — the harder case.

---

## When to extract a schema

A feature earns its own Postgres schema when ALL of these hold:

1. **Cluster size justifies the noise reduction.** 5+ tables sharing a domain prefix (`wiki_*`, `routine_*`, `sandbox_*`, etc.) is the threshold. Smaller clusters can stay in `public.*` with file-level grouping in `packages/database-pg/src/schema/`.
2. **A clean code-side module already exists.** `packages/api/src/lib/<feature>/` is a coherent directory, not scattered across multiple libs. If the code boundary is weak, fix that first — schema extraction won't paper over it.
3. **Operator-facing namespace win is real.** Someone reading the DB via `psql \dt`, a BI tool, or backups would benefit from the segregation. If the only motivation is code-side organization, prefer directory-level grouping over Postgres-level schemas (cheaper to maintain).
4. **No cross-schema entanglement constraints block it.** Tables can have FK references to `public.tenants`, `public.users`, etc. — Postgres supports cross-schema FKs natively. But verify no application code does ad-hoc `pg_dump --schema=<feature>` that would break with cross-schema FKs in place.

Counterexamples (do not extract): a single `routines` table (no cluster); a feature where `lib/<feature>/` doesn't exist or is fragmented; a feature whose only motivation is "make the schema file shorter" (use directory grouping instead).

---

## Three-PR sequence (per feature)

A schema extraction ships as a coordinated three-PR arc:

| PR | Scope | Compat-view state |
|---|---|---|
| **PR 1** | Move tables to `<feature>.*` + rename to drop redundant prefix + create compat views in `public.*` + update all consumers + (first feature only) land the pre-merge CI gate | Views ON |
| **PR 2** | (Only if a sibling feature is extracted in the same arc, e.g., `wiki` + `brain`) Same pattern as PR 1, no CI gate addition | Views ON |
| **PR 3** | Drop all compat views | Views OFF |

For a single-feature extraction, the sequence is two PRs: PR 1 (extract + views ON) and PR 2 (cleanup).

Each PR is independently revertible. The compat views in `public.*` mean even a same-day rollback keeps application code functional during the window — old query paths via `public.<old_name>` continue to resolve.

---

## Migration template

Hand-rolled SQL, NOT Drizzle-generated. Drizzle's `db:generate` cannot emit `ALTER TABLE ... SET SCHEMA`. The migration is operator-applied via `psql -f` to dev AND prod before the PR merges.

```sql
-- NNNN_<feature>_schema_extraction.sql
--
-- <Feature> schema extraction: moves N tables from public.<prefix>_* into <feature>.*
-- and renames to drop the redundant <prefix>_ prefix during the move. Adds compat
-- views in public.* so old bundled Lambda code keeps reading during the deploy
-- bridge window. Drop the views in a follow-up PR.
--
-- Plan reference:   docs/plans/YYYY-MM-DD-NNN-<type>-<name>-plan.md
-- Origin brainstorm: docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_<feature>_schema_extraction.sql
-- Then verify:
--   pnpm db:migrate-manual
--   psql -c "\dt <feature>.*"
--   psql -c "\dv public.<prefix>_*"   -- confirms compat views exist
--
-- Inverse runbook (rollback): drop the views, then SET SCHEMA back, then RENAME back.
--   DROP VIEW IF EXISTS public.<prefix>_<table>;  -- × N tables
--   ALTER TABLE <feature>.<new> RENAME TO <prefix>_<table>;  -- × N
--   ALTER TABLE <feature>.<prefix>_<table> SET SCHEMA public;  -- × N
--   DROP SCHEMA <feature>;
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- creates: <feature>.<table_1>
-- creates: <feature>.<table_2>
-- ...
-- creates: public.<prefix>_<table_1>   -- compat view
-- creates: public.<prefix>_<table_2>   -- compat view
-- ...
-- creates-constraint: <feature>.<table>.<fk_constraint_name>  -- for FKs whose pg_constraint namespace path moves

\set ON_ERROR_STOP on

BEGIN;

-- Serialize concurrent application attempts (two operators racing, automation overlap).
SELECT pg_advisory_xact_lock(hashtext('<feature>_schema_extraction'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight invariants: refuse to re-apply over a partially-completed previous run.
-- For each table, assert old name exists AND new name does not.
DO $$
BEGIN
  IF to_regclass('public.<prefix>_<table_1>') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.<prefix>_<table_1> does not exist';
  END IF;
  IF to_regclass('<feature>.<table_1>') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: <feature>.<table_1> already exists — refusing to re-apply';
  END IF;
  -- ... repeat for every table
END $$;

CREATE SCHEMA IF NOT EXISTS <feature>;
COMMENT ON SCHEMA <feature> IS '<one-line purpose>';

-- Move tables in FK-leaf-first order (children before parents).
ALTER TABLE public.<prefix>_<leaf_table> SET SCHEMA <feature>;
ALTER TABLE <feature>.<prefix>_<leaf_table> RENAME TO <leaf_table>;
-- ... repeat for every table

-- Compat views: each table gets a view in public.* aliasing the new location.
-- Postgres simple views are auto-updatable, so old write paths continue to work.
CREATE VIEW public.<prefix>_<leaf_table> AS SELECT * FROM <feature>.<leaf_table>;
-- ... repeat for every table

COMMIT;
```

**Critical conventions:**

- **Advisory lock first** — `pg_advisory_xact_lock(hashtext('<feature>_schema_extraction'))` immediately after `BEGIN;`. Without it, two operators racing the apply (or one operator + automation) can both pass pre-flight checks and produce corrupted state.
- **Pre-flight invariants** — `to_regclass()` checks for every table before moving. Refuses re-application; catches partial-state recovery scenarios.
- **FK topology ordering** — move children before parents. Postgres preserves FKs across `SET SCHEMA` automatically; ordering matters only for the operator's mental model.
- **Compat views are created AFTER the rename**, in the same transaction. They reference the new schema-qualified name (`<feature>.<table>`), not the renamed-but-not-moved name.
- **Marker block** — every table gets a `-- creates:` marker; every FK constraint whose namespace path moves gets a `-- creates-constraint:` marker (Postgres relocates the constraint along with the table, but `pg_constraint.connamespace` changes). The drift reporter uses these to verify post-apply state.

---

## Drizzle source wiring

Mirror `packages/database-pg/src/schema/compliance.ts`:

```typescript
// packages/database-pg/src/schema/<feature>.ts
import { pgSchema, /* ... */ } from "drizzle-orm/pg-core";

export const <feature> = pgSchema("<feature>");

export const featurePages = <feature>.table(
  "pages",  // drop the <prefix>_ prefix here
  { /* columns */ },
  (table) => [ /* indexes */ ],
);

// ... relations, type exports
```

**Critical conventions:**

- Keep the TS export identifier stable (`featurePages` stays the same) so consumer imports don't churn. Only the in-DB table name changes.
- Cross-schema FKs (`.references(() => tenants.id)`) work unchanged — Drizzle references the JS handle, not a table name.
- GIN access methods, partial indexes, and any non-standard DDL: the SQL migration is the source of truth, not the TS file. Drizzle's `.using("gin", ...)` annotations are documentation; the actual `CREATE INDEX` lives in the migration.

Update `packages/database-pg/src/schema/index.ts` to re-export from the new file. Remove old re-exports for files being deleted (if consolidating multiple files into one).

---

## Consumer audit checklist

Run BEFORE editing any consumer code (the recipe from `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`):

```bash
# Drizzle imports (TS export identifiers — these don't change but verify path stability):
rg -l 'from.*@thinkwork/database-pg' packages/ apps/

# Raw SQL with the OLD table names (these MUST be updated):
rg 'FROM public\.<prefix>_|JOIN public\.<prefix>_|FROM <prefix>_|JOIN <prefix>_' .

# Hand-built dynamic SQL with table-name literals:
rg "'<prefix>_[a-z_]+'::text|\"<prefix>_[a-z_]+\"" packages/ apps/

# Codegen consumers (re-run codegen after schema changes):
rg 'codegen' --files-with-matches packages/*/package.json apps/*/package.json
```

The grep results are the authoritative consumer list — the plan's enumerated `Files:` sections are a starting point, not the final list. Plans inevitably miss files; the survey catches them.

For each consumer file, the change shape depends on what it does:

| Consumer type | Change |
|---|---|
| Drizzle-typed queries | Import paths stay the same (TS export identifier preserved) — no code change needed |
| Raw SQL with old table names in query body | Replace `public.<prefix>_<table>` → `<feature>.<table>` |
| Hand-built table-name literal strings emitted on the wire | Decide opaque-vs-rename. Opaque (recommended) keeps `'<prefix>_<table>'` as a stable wire discriminator decoupled from storage; rename requires a coordinated mobile/persisted-state migration |
| Lambdas with bundled Drizzle source (`graphql-http`, `wiki-compile`, `wiki-bootstrap-import`, `memory-retain`, `eval-runner` per `scripts/build-lambdas.sh`) | Run `pnpm build:lambdas` to refresh bundles; verify `aws lambda get-function-configuration` shows fresh `LastModified` post-deploy |

---

## Codegen regeneration

After the Drizzle source rewrite, GraphQL types don't change (the schema GraphQL stays the same — only internal Drizzle row types shift), but every consumer with a `codegen` script should still re-run as a sanity check:

```bash
pnpm --filter @thinkwork/admin codegen
pnpm --filter @thinkwork/mobile codegen
pnpm --filter @thinkwork/cli codegen
pnpm schema:build   # AppSync subscription schema derivative
```

`packages/api` has no `codegen` script — skip.

If codegen produces unexpected diffs, the GraphQL types may have drifted accidentally. Investigate before committing.

---

## Pre-merge CI gate (one-time setup per repo)

The first feature-schema extraction in the repo should land a pre-merge CI gate that runs `pnpm db:migrate-manual` against the dev DB on every PR touching `packages/database-pg/drizzle/*.sql`. Once in place, every subsequent hand-rolled migration benefits.

Pattern (in `.github/workflows/ci.yml`):

```yaml
migration-drift-precheck:
  if: contains(github.event.pull_request.changed_files, 'packages/database-pg/drizzle/')
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
        aws-region: us-east-1
    - name: Resolve dev DATABASE_URL from Secrets Manager
      run: |
        # (same pattern as the disabled migration-drift-check job in deploy.yml)
        # extract: secretsmanager get-secret-value, terraform outputs for endpoint, sslmode=require
    - name: Verify markers applied to dev
      run: bash scripts/db-migrate-manual.sh
```

This is distinct from the disabled deploy-time `migration-drift-check` job in `deploy.yml` (whose ~150-per-deploy connection flake is a separate problem). This gate is single-connection, runs once per PR, and fails the PR check on MISSING or UNVERIFIED markers.

---

## Deploy-order rule

This is the single most important operational discipline. Get it wrong and the institutional learning at `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` adds a sixth incident to its list.

**Order:**

1. **Author the migration locally.** Run it against dev via `psql -f` while iterating to verify correctness.
2. **Author the consumer code changes** that match the new Drizzle source.
3. **Open the PR.** CI runs the pre-merge gate (`migration-drift-precheck` job). Operator has already applied to dev in step 1 — markers should be APPLIED. Gate passes.
4. **Apply the migration to prod via `psql -f`** ONLY AFTER PR review is complete and merge is imminent. The compat views (`CREATE VIEW public.<old> AS SELECT * FROM <feature>.<new>`) mean even a small timing gap between psql-on-prod and Lambda redeploy is safe — old Lambdas read via the view, new Lambdas read the schema directly.
5. **Merge the PR.** Post-merge deploy pipeline rebuilds and redeploys Lambdas with the new bundled Drizzle source.
6. **Verify post-deploy:** smoke-test the affected features in dev; confirm `aws lambda get-function-configuration` shows fresh `LastModified` on bundled handlers.

**Do NOT:**

- Apply to prod BEFORE the PR is approved — if the PR is rejected, you have a schema in prod with no consumer code, awkward to reverse.
- Skip the dev apply — the CI gate will fail, blocking merge.
- Merge before prod apply — the post-merge deploy will redeploy Lambdas with new bundled code that queries the new schema, against a prod DB that still has the old schema. Even with compat views (which exist in dev only at this point), the prod state is broken. **Read this sequence twice.**

---

## Future applicants

Non-binding list of feature clusters that could earn their own schema. Each requires its own brainstorm + plan + audit:

- **`routines.*`** — `routines`, `routine_executions`, `routine_step_events`, `routine_asl_versions`, `routine_approval_tokens` (5 tables in `packages/database-pg/src/schema/routine-*.ts`)
- **`sandbox.*`** — `sandbox_invocations`, `sandbox_quota_counters` (2 tables; small cluster, may not earn a schema)
- **`evaluations.*`** — `evaluations.ts` cluster (~8 tables)
- **`agents.*`** — `agents`, `agent_templates`, `agent_workspace_events` (3 tables)
- **`mcp.*`** — `mcp_servers`, `mcp_admin_keys` (2 tables; marginal)
- **`webhooks.*`** — `webhooks`, `webhook_deliveries` (2 tables; marginal)

The smallest clusters (sandbox, mcp, webhooks) probably don't earn a Postgres schema — directory-grouping in `packages/database-pg/src/schema/<feature>/` is enough. The larger clusters (routines, evaluations) likely do.

When promoting any of these from "could earn" to "is earning," follow this pattern doc and the per-feature requirements document for any feature-specific concerns.
