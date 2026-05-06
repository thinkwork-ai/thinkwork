---
title: "feat: Thinkwork connector data model + tenant_entity_external_refs extension"
type: feat
status: active
date: 2026-05-05
origin: ../../../symphony/docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md
master_plan: ../../../symphony/docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md
master_unit: U1
---

# feat: Thinkwork connector data model + tenant_entity_external_refs extension

**Master plan:** `(symphony) docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md` — this child plan covers master plan U1.
**Origin requirements doc:** `(symphony) docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md`.
**Target repo:** `thinkwork` (this repo).

---

## Summary

Lands the multi-tenant connector framework's data foundation as four atomic-PR sub-units: connector tables (Drizzle SQL + TS schema), `tenant_entity_external_refs.source_kind` CHECK enum extension for tracker work-item mirroring, GraphQL SDL + read resolvers, and admin-gated mutations. Ships inert — no live dispatch handlers exist yet (master plan U2 adds them). Resolves the master plan's money-type residual by adopting `bigint` cents to match `routine_executions.total_llm_cost_usd_cents` rather than introducing symphony's `NUMERIC(10,4)`.

---

## Problem Frame

Thinkwork's connector framework needs a stable schema seam before any reconciler, callback, spend-enforcement, or adapter work can land. Building those substrate primitives without first declaring the table shape risks each one inventing its own opinion on connector lifecycle, leaving a patchwork data model. This plan is the foundation unit referenced by master plan U2/U3/U4 — they consume the column shapes declared here. (See origin: `(symphony) docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md` Problem Frame for the broader connector-first product context.)

---

## Requirements

This plan inherits relevant origin R-IDs and adds plan-time technical requirements (PR-prefixed, scoped to U1).

**Inherited from origin (full detail in origin doc):**
- R4. Connector framework abstraction with uniform "configure a connector" surface
- R5. Connector taxonomy — poll-and-reconcile, webhook-driven, channel-input, schedule-driven, heartbeat, manual, event-driven
- R6. Connectors dispatch to multiple target shapes (agent, deterministic routine, hybrid routine)
- R7. Connector framework is multi-tenant from day one
- R8. Tracker connectors treat external system as canonical lifecycle owner; thinkwork reconciles its mirror
- R11. Each external work-item has a corresponding internal thread (the linkage table is what U1 ships; thread creation is master plan U6)

**Plan-time requirements (this child plan):**
- PR1. All new tables carry `tenant_id` FK to `tenants`. Every aggregation on these tables uses `WHERE tenant_id = $1`. No retrofit.
- PR2. All new GraphQL mutations call `requireTenantAdmin(ctx, tenantId)` before any side effect, per `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`.
- PR3. Hand-rolled SQL ships with `-- creates: public.X` markers in the header and a paired `_rollback.sql` with `-- drops: public.X` markers, per `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- PR4. Drizzle TS schema files mirror the SQL exactly. CHECK constraints declared in SQL are also declared in TS via `check(...)` so `drizzle-kit generate` doesn't propose to drop them on snapshot diff (per AGENTS.md).
- PR5. Money columns use `bigint(mode: number)` cents matching `routine_executions.total_llm_cost_usd_cents`. Symphony's `NUMERIC(10,4)` does not carry forward.
- PR6. The `connector_executions` partial unique index `(connector_id, external_ref) WHERE current_state IN <active_set>` ships in U1 as defense-in-depth. The CAS logic that uses it lands in master plan U2.
- PR7. This unit ships **inert**: schema + read resolvers + admin mutations exist; no Lambda or background process reads `connectors` to dispatch work. Master plan U2's `connector-poll-handler` activates the table.

**Origin actors:** A1 (customer admin — primary user of mutations), A3 (thinkwork operator — reads via cross-tenant queries in U10, not landed here), A4 (external system — `tracker_issue` / `tracker_ticket` mirror entries reference external IDs)

**Origin flows:** F5 (connector configuration — mutations land here; admin SPA UX is master plan U9)

**Origin acceptance examples:** AE6 (per-tenant isolation — U1's tenant_id discipline + composite unique on `(tenant_id, name)` enforce this at the schema layer)

---

## Scope Boundaries

**Plan-local non-goals:**

### Deferred to Follow-Up Work

- Connector poll handler, reconciler, claim CAS logic — master plan U2
- Signed callback ingress library (HMAC v1) — master plan U3
- Spend reservation / actuals / reconciliation tables and primitives — master plan U4 (this unit provisions the `spend_envelope_usd_cents` and `cost_finalized_at` columns on `connector_executions` as surfaces; the reservation table and library land in U4)
- Stage instrumentation parity test — master plan U5
- Linear adapter and adapter-specific normalization — master plan U7
- Admin SPA `_authed/_tenant/automations/connectors/` route + components — master plan U9
- Cross-tenant operator surface and `thinkwork_operator` Cognito group — master plan U10
- Cooperative-stop debounce logic — master plan U10/PR6 (this unit provisions the `kill_target` and `kill_target_at` columns on `connector_executions` as surfaces; the debounce logic lands in U10)
- IAM policy provisioning, EventBridge schedule scoping with per-tenant SourceArn conditions — master plan U2 (master plan PR4 applies to U2, not U1)
- Hybrid routine authoring polish, n8n-alternative positioning surfaces — master plan U8
- Symphony dogfood migration and repo archival — master plan U11
- Public positioning reset — master plan U12
- Authorization model decision (Cognito groups vs. existing `tenant_members.role`) — master plan U10 child plan resolves this; U1 stays consistent with the existing `requireTenantAdmin` pattern based on `tenant_members.role`
- Multi-tenant HMAC secret resolution shape — master plan U3 child plan
- Reconciliation of agent_invoke sync vs. symphony's async-ack contract — master plan U2/U3 child plans

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/src/schema/scheduled-jobs.ts` — `trigger_type` is freeform `text`; the in-comment taxonomy is documented but the database has no CHECK enum. The same pattern applies for `connectors.type`.
- `packages/database-pg/src/schema/routines.ts` — engine partition pattern (`legacy_python | step_functions` enforced by CHECK); `current_version` integer pointer; soft-FK to `routine_asl_versions`. Precedent for CHECK enum on a partition column.
- `packages/database-pg/src/schema/routine-executions.ts` — execution-row pattern: pre-emptive INSERT at trigger time, status flipped via callback, `bigint(mode: number)` for cents-based money, partial unique on `sfn_execution_arn`.
- `packages/database-pg/src/schema/threads.ts` — `channel` column as freeform text; `metadata: jsonb` for additive per-row context; lifecycle timestamps pattern (`started_at`, `completed_at`, `cancelled_at`).
- `packages/database-pg/src/schema/scheduled-jobs.ts` (`thread_turns` table) — execution-record per invocation; `(run_id, seq)` ordering; per-tenant indexes; FK discipline.
- `packages/database-pg/src/schema/integrations.ts` — `connections` + `credentials` are the per-tenant secret vault. `connectors.connection_id` FKs into `connections` rather than re-inventing.
- `packages/database-pg/src/schema/tenant-entity-external-refs.ts` — verified CHECK enum is `('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb')`. Verified partial unique index is `WHERE external_id IS NOT NULL` (no active/non-active filter — this is fine because tenant_entity_external_refs is a 1:1 mapping table, not a claim table).
- `packages/database-pg/src/schema/webhooks.ts` — `target_type IN ('agent', 'routine')` precedent; the new `connectors.dispatch_target_type` extends this enum to include `hybrid_routine`.
- `packages/database-pg/graphql/types/*.graphql` — GraphQL SDL location. `pnpm schema:build` regenerates `terraform/schema.graphql`; downstream consumers (`apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`) re-run codegen.
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` — `resolveCallerTenantId(ctx)` fallback for Google-federated users (verified: `packages/api/src/graphql/resolvers/routines/query.ts` imports from here as `import { resolveCallerTenantId } from "../core/resolve-auth-user.js";`).
- `packages/api/src/graphql/resolvers/core/authz.ts` — `requireTenantAdmin(ctx, tenantId)` is the universal mutation gate.
- `packages/database-pg/drizzle/` — hand-rolled SQL convention. Each `<n>_<name>.sql` ships paired `<n>_<name>_rollback.sql`. Marker convention: `-- creates: public.X` / `-- drops: public.X`.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — `db:migrate-manual` is the deploy gate; missing `-- creates: public.X` markers fail the gate.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — institutional rule.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — multi-PR seam discipline. U1 ships structurally; U2 swaps to live by adding the dispatch handlers.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` — Inbox pivot pattern. Confirms the choice to extend `tenant_entity_external_refs.source_kind` rather than introduce a parallel mapping table.

### External References

External research skipped — local thinkwork patterns are strong (multiple direct precedents: `routines`, `scheduled_jobs`, `routine_executions`, `webhooks`, `tenant_entity_external_refs`). Symphony's substrate decisions inform the design constraints captured in the master plan; this child plan does not import.

---

## Key Technical Decisions

- **Money type: `bigint` cents.** Resolves master plan residual. `connector_executions.spend_envelope_usd_cents` matches `routine_executions.total_llm_cost_usd_cents`. Single cost vocabulary across thinkwork. Symphony's `NUMERIC(10,4)` does NOT carry forward.
- **Polymorphic dispatch target without DB-level FK.** `connectors.dispatch_target_id` is a single `uuid` column whose target table is determined by `dispatch_target_type` (`agent` | `routine` | `hybrid_routine`). Application-layer validation in resolvers; no DB CHECK joining target tables. Alternative considered: separate `dispatch_target_agent_id` / `dispatch_target_routine_id` columns with FKs to each — rejected because routes are 1-of-N and the application layer already enforces the discipline.
- **`connector_executions.current_state` enum named to match thinkwork conventions.** `pending | dispatching | invoking | recording_result | terminal | failed | cancelled`. CHECK constraint at SQL layer; mirrored in Drizzle TS via `check(...)`. Symphony's pattern (`runs.current_state`) carries as design only.
- **`connectors.status` enum.** `active | paused | unhealthy | archived`. CHECK constraint enforced. `archived` is soft-delete (rows persist for audit); paused stops dispatch via `enabled=false`-equivalent semantics.
- **`connectors.type` is freeform text, not CHECK enum.** Mirrors `scheduled_jobs.trigger_type` precedent. Adding a new connector type is a doc + adapter change, not a migration. Initial values in scope: `linear_tracker`. Future: `salesforce_webhook`, `gmail_channel`, etc.
- **`tenant_entity_external_refs.source_kind` extension via DROP/RECREATE CHECK.** Existing CHECK is hardcoded; adding new values requires DROP CONSTRAINT + ADD CONSTRAINT with the merged set. Paired rollback restores the prior 6-value CHECK. Symphony U3 residual confirms this discipline.
- **New `source_kind` values added in this unit:** `tracker_issue`, `tracker_ticket`. Covers Linear (`tracker_issue`) and downstream Jira/Salesforce/Zendesk-style trackers without per-provider source_kind values. Subsequent connector types add their own values via similar migrations.
- **Inert-to-live seam: absent dispatch handlers, no feature flag.** Schema + resolvers ship; nothing reads `connectors` to act except admin queries. Master plan U2's poll handler activates the table by adding the `connector_poll` branch in `job-trigger.ts`.
- **`connector_executions` carries U2/U4/U10 surfaces as columns.** `state_machine_arn` (U2 populates), `cost_finalized_at` (U4 CAS surface), `last_usage_event_at` (U4 populates), `kill_target` + `kill_target_at` (U10 populates with PR6 debounce). Provisioning these as columns now keeps downstream migrations small.
- **Plan filename and frontmatter origin path.** Child plan lives in thinkwork's `docs/plans/`; origin frontmatter uses repo-relative `../../../symphony/docs/...` to reach the master plan and brainstorm in the sibling repo.

---

## Open Questions

### Resolved During Planning

- **Money type collision (master plan residual):** bigint cents. Resolved.
- **Polymorphic dispatch target shape:** single `dispatch_target_id` + `dispatch_target_type` discriminator. Resolved.
- **`tenant_entity_external_refs.source_kind` extension shape:** DROP/RECREATE CHECK with paired rollback. Resolved.
- **Inert-to-live seam mechanism:** absent dispatch handlers, no feature flag. Resolved.
- **`connectors.last_poll_cursor` shape:** `text` (provider-opaque). Adapters know their format. Alternative `jsonb` deferred until a connector type needs structured cursors.
- **Child-plan filename:** `docs/plans/2026-05-05-001-feat-thinkwork-connector-data-model-plan.md`. No prior 2026-05-05 plans in thinkwork.

### Deferred to Implementation

- **Exact migration prefix number:** the next sequential prefix in `packages/database-pg/drizzle/` after the latest hand-rolled migration. Pick at execution time when staging changes.
- **Whether `connectors.config` JSONB needs a Zod-style validator at the resolver layer for v0:** lean toward yes for `config` shapes that vary per `connectors.type` (the catalog from master plan U2 will define them). Resolve in U4 (this child plan's U4, the GraphQL admin mutations).
- **GraphQL pagination shape for `connectorExecutions`:** match existing thinkwork pagination convention (cursor-based per `docs/runbooks/...` if documented; otherwise mirror `routineExecutions` resolver pagination). Verify existing pattern at execution time.
- **Codegen sweep details:** `pnpm schema:build` regenerates `terraform/schema.graphql`; consumer codegen runs in `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`. Exact filter set and order verified at execution time per AGENTS.md.

---

## Output Structure

Files this plan creates or modifies in the thinkwork repo:

    thinkwork/
    ├── packages/database-pg/
    │   ├── drizzle/
    │   │   ├── NNNN_connector_tables.sql                # U1 (new)
    │   │   ├── NNNN_connector_tables_rollback.sql       # U1 (new, paired)
    │   │   ├── NNNN_extend_external_refs_source_kind.sql           # U2 (new)
    │   │   └── NNNN_extend_external_refs_source_kind_rollback.sql  # U2 (new, paired)
    │   ├── src/schema/
    │   │   ├── connectors.ts                            # U1 (new) — Drizzle TS for connectors table
    │   │   ├── connector-executions.ts                  # U1 (new) — Drizzle TS for connector_executions table
    │   │   ├── tenant-entity-external-refs.ts           # U2 (modify) — update CHECK literal in TS to mirror SQL
    │   │   └── index.ts                                 # U1 (modify) — re-export new tables
    │   └── graphql/types/
    │       └── connectors.graphql                       # U3 (new) — SDL types + queries + mutations
    └── packages/api/src/graphql/resolvers/
        ├── connectors/
        │   ├── query.ts                                 # U3 (new) — connectors, connector, connectorExecutions, connectorExecution
        │   └── mutation.ts                              # U4 (new) — createConnector, updateConnector, pauseConnector, resumeConnector, archiveConnector
        └── index.ts                                     # U3, U4 (modify) — register new resolvers

Note on cross-plan U-ID disambiguation: this child plan's U1–U4 are local to this document. References to the master plan's units (e.g., master plan U2 connector chassis, master plan U4 spend enforcement) are always written with the "master plan" prefix throughout. Bare "U1"–"U4" in this document refers to this child plan's sub-units.

---

## Implementation Units

### U1. Connector tables: SQL migration + Drizzle TS schema

**Goal:** Create `connectors` and `connector_executions` tables with full column shape, constraints, and indexes. Drizzle TS files mirror the SQL.

**Requirements:** R4, R6, R7, R8, R11; PR1, PR3, PR4, PR5, PR6

**Dependencies:** None — foundation unit.

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_connector_tables.sql`
- Create: `packages/database-pg/drizzle/NNNN_connector_tables_rollback.sql`
- Create: `packages/database-pg/src/schema/connectors.ts`
- Create: `packages/database-pg/src/schema/connector-executions.ts`
- Modify: `packages/database-pg/src/schema/index.ts` (re-export)
- Test: `packages/database-pg/__tests__/connector-schema.test.ts` (new — verifies migration applies, indexes/constraints present, rollback applies cleanly)

**Approach:**
- `connectors` columns: `id uuid PK gen_random_uuid()`, `tenant_id uuid NOT NULL → tenants(id) ON DELETE CASCADE`, `type text NOT NULL`, `name text NOT NULL`, `description text`, `status text NOT NULL DEFAULT 'active'`, `connection_id uuid → connections(id)` (nullable; some connector types may not have credential rows), `config jsonb`, `dispatch_target_type text NOT NULL`, `dispatch_target_id uuid NOT NULL`, `last_poll_at timestamptz`, `last_poll_cursor text`, `next_poll_at timestamptz`, `eb_schedule_name text` (populated by U2; nullable here), `enabled boolean NOT NULL DEFAULT true`, `created_by_type text`, `created_by_id text`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- `connectors` constraints: CHECK `status IN ('active','paused','unhealthy','archived')`, CHECK `dispatch_target_type IN ('agent','routine','hybrid_routine')`, UNIQUE `(tenant_id, name)`.
- `connectors` indexes: `idx_connectors_tenant_status (tenant_id, status)`, `idx_connectors_tenant_type (tenant_id, type)`, `idx_connectors_enabled (tenant_id, enabled)`.
- `connector_executions` columns: `id uuid PK`, `tenant_id uuid NOT NULL → tenants(id) ON DELETE CASCADE`, `connector_id uuid NOT NULL → connectors(id) ON DELETE RESTRICT`, `external_ref text NOT NULL`, `current_state text NOT NULL DEFAULT 'pending'`, `spend_envelope_usd_cents bigint`, `state_machine_arn text` (set by U2 master), `started_at timestamptz`, `finished_at timestamptz`, `error_class text`, `outcome_payload jsonb`, `cost_finalized_at timestamptz` (CAS surface for U4 master), `last_usage_event_at timestamptz` (U4 master populates), `kill_target text` (U10 master populates with `cooperative` | `hard`), `kill_target_at timestamptz` (PR6 debounce surface), `retry_attempt integer NOT NULL DEFAULT 0`, `created_at timestamptz NOT NULL DEFAULT now()`.
- `connector_executions` constraints: CHECK `current_state IN ('pending','dispatching','invoking','recording_result','terminal','failed','cancelled')`, CHECK `kill_target IS NULL OR kill_target IN ('cooperative','hard')`, CHECK `spend_envelope_usd_cents IS NULL OR spend_envelope_usd_cents >= 0`, CHECK `retry_attempt >= 0`.
- `connector_executions` indexes: partial unique `(connector_id, external_ref) WHERE current_state IN ('pending','dispatching','invoking','recording_result')`, `idx_ce_tenant_state (tenant_id, current_state)`, `idx_ce_connector_started (connector_id, started_at)`, `idx_ce_state_machine_arn (state_machine_arn)` non-unique, `idx_ce_external_ref (tenant_id, external_ref)`.
- `updated_at` column is application-managed in thinkwork (verified: existing tables like `tenant_entity_external_refs`, `connections`, `routine_executions` carry `updated_at` with no DB trigger; updates go through resolver code paths). Match this convention — declare `updated_at timestamptz NOT NULL DEFAULT now()` in SQL but do NOT add a `set_updated_at()` trigger. Resolver mutations (U4) bump `updated_at = now()` in their UPDATE statements explicitly.
- SQL header markers (verified against `scripts/db-migrate-manual.sh` valid prefixes — `creates`, `creates-column`, `creates-extension`, `creates-constraint`, `creates-function`, `creates-trigger`): tables use `-- creates: public.connectors`, `-- creates: public.connector_executions`. Indexes use plain `-- creates: public.uq_connectors_tenant_name` (no table prefix; `to_regclass` resolves indexes too). Multi-column CHECK constraints not separately marked at table-creation time (the table-creates marker covers the CHECK as part of CREATE TABLE). Rollback uses `-- drops:` markers with reverse-FK-order DROP statements. **Do NOT use `creates-index` — that prefix is not recognized by the migration runner.**
- Drizzle TS files declare CHECK constraints via `check(...)` so `drizzle-kit generate` doesn't propose to drop them (PR4).

**Patterns to follow:**
- `packages/database-pg/src/schema/routines.ts` (engine CHECK partition pattern)
- `packages/database-pg/src/schema/routine-executions.ts` (execution-row shape, bigint cents, partial unique on identifier)
- `packages/database-pg/src/schema/scheduled-jobs.ts` (freeform `trigger_type` precedent)
- `packages/database-pg/src/schema/integrations.ts` (`connections` FK reuse)

**Test scenarios:**
- Happy path: migration applies cleanly against empty schema; `\d connectors` and `\d connector_executions` show expected columns + constraints + indexes; row inserts with valid values succeed.
- Edge case: composite unique on `(tenant_id, name)` prevents duplicate same-tenant connector names but allows same name across two tenants.
- Edge case: partial unique on `(connector_id, external_ref) WHERE current_state IN ('pending','dispatching','invoking','recording_result')` allows re-claim — same `external_ref` re-INSERT after the prior row's `current_state` flips to `terminal`/`failed`/`cancelled`.
- Error path: insert with `status='unknown'` rejected by CHECK constraint.
- Error path: insert with `dispatch_target_type='lambda'` rejected by CHECK constraint.
- Error path: insert with negative `spend_envelope_usd_cents` rejected by CHECK constraint.
- Error path: cascade delete — deleting a tenant cascades to its connectors and their executions; no orphan rows.
- Error path: deleting a connector that has connector_executions rows fails (ON DELETE RESTRICT).
- Integration: rollback applies cleanly; tables and indexes drop in reverse-FK order; migration can be re-applied after rollback.
- Integration: `pnpm db:migrate-manual` reports both tables present after apply, both absent after rollback.
- Integration: Drizzle TS introspection (`drizzle-kit introspect`) reads the migrated schema and produces TS that matches the hand-written `connectors.ts` + `connector-executions.ts` (no spurious diffs on `drizzle-kit generate`).

**Verification:**
- Migration applies + rolls back cleanly in dev.
- `pnpm db:migrate-manual` reports no drift after apply.
- Drizzle TS schema matches SQL exactly (CHECK constraints, partial indexes, FKs).
- All tests pass.

---

### U2. Extend `tenant_entity_external_refs.source_kind` CHECK enum

**Goal:** Add `tracker_issue` and `tracker_ticket` to the `source_kind` CHECK constraint so connector-driven external work-items can be mirrored via this table. DROP CHECK + ADD CHECK with the merged set; paired rollback restores the prior 6-value CHECK.

**Requirements:** R8, R11; PR3, PR4

**Dependencies:** None (independent of U1; can land in either order, though convention groups them adjacent).

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_extend_external_refs_source_kind.sql`
- Create: `packages/database-pg/drizzle/NNNN_extend_external_refs_source_kind_rollback.sql`
- Modify: `packages/database-pg/src/schema/tenant-entity-external-refs.ts` (update the CHECK literal in TS to the new 8-value set)

**Approach:**
- SQL: `ALTER TABLE public.tenant_entity_external_refs DROP CONSTRAINT tenant_entity_external_refs_kind_allowed; ALTER TABLE public.tenant_entity_external_refs ADD CONSTRAINT tenant_entity_external_refs_kind_allowed CHECK (source_kind IN ('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb','tracker_issue','tracker_ticket'));`
- Marker: `-- creates-constraint: public.tenant_entity_external_refs.tenant_entity_external_refs_kind_allowed` (the migration runner probes constraints via `pg_catalog.pg_constraint`; plain `creates:` will fail the deploy gate because `to_regclass` does not resolve constraints).
- Rollback: reverse — DROP CONSTRAINT, ADD CONSTRAINT with the prior 6-value set. Markers: `-- drops-constraint: public.tenant_entity_external_refs.tenant_entity_external_refs_kind_allowed` followed by `-- creates-constraint: public.tenant_entity_external_refs.tenant_entity_external_refs_kind_allowed` for the restored prior version.
- Drizzle TS update: change the `check(...)` literal in `tenant-entity-external-refs.ts` to match the new 8-value set so snapshot diff is clean.
- The existing partial unique index `WHERE external_id IS NOT NULL` is fine — it does not filter by status. Tracker work-items get a row per `(tenant_id, source_kind='tracker_issue', external_id)`. Re-claim semantics for connector executions live in `connector_executions`'s partial unique (U1), not here. This table is the 1:1 mapping; re-claim is at the execution-row level.

**Patterns to follow:**
- `packages/database-pg/drizzle/` existing CHECK-extension migrations (verify any prior precedent at execution time)
- `packages/database-pg/src/schema/tenant-entity-external-refs.ts` existing `check(...)` declaration

**Test scenarios:**
- Happy path: migration applies cleanly; existing rows with old `source_kind` values remain valid; new INSERT with `source_kind='tracker_issue'` succeeds.
- Edge case: existing rows with `source_kind='erp_customer'` still pass the new CHECK (no data invalidation).
- Error path: INSERT with `source_kind='unknown'` rejected by new CHECK.
- Integration: rollback applies cleanly; `source_kind='tracker_issue'` row pre-existing at rollback time becomes invalid (rollback does NOT delete data — operator-discretion call documented in rollback file header).
- Integration: `pnpm db:migrate-manual` reports the CHECK constraint present with the new 8-value definition after apply.
- Integration: `drizzle-kit generate` against the updated TS produces no diff (CHECK literal in TS matches the SQL).

**Verification:**
- New `source_kind` values accepted; old values still pass.
- Rollback path documented with explicit "rollback after data exists with new values requires manual cleanup" note in the rollback file header.

---

### U3. GraphQL SDL + read resolvers

**Goal:** Add GraphQL types, queries, and resolvers for read-only connector data. Mutations land in U4.

**Requirements:** R4, R7; PR2 (read resolvers gate by `tenant_id` discipline; mutations land in U4)

**Dependencies:** U1 (tables exist).

**Files:**
- Create: `packages/database-pg/graphql/types/connectors.graphql` (SDL)
- Create: `packages/api/src/graphql/resolvers/connectors/query.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts` (register query resolvers)
- Test: `packages/api/src/graphql/resolvers/connectors/__tests__/query.test.ts` (new)
- Test: `packages/api/test/integration/connector-query.test.ts` (new — integration against real DB)

**Approach:**
- Types declared in SDL: `Connector`, `ConnectorExecution`, `ConnectorStatus` enum (`active | paused | unhealthy | archived`), `DispatchTargetType` enum (`agent | routine | hybrid_routine`), `ConnectorExecutionState` enum (`pending | dispatching | invoking | recording_result | terminal | failed | cancelled` — exactly mirrors the SQL CHECK in U1), `ConnectorFilter` input.
- Queries follow the existing `routineExecutions` precedent (`packages/database-pg/graphql/types/routines.graphql` returns flat `[RoutineExecution!]!` lists with cursor passed as opaque timestamp string; no `Page` wrapper). Resolver shape: `connectors(filter: ConnectorFilter, limit: Int, cursor: String): [Connector!]!`, `connector(id: ID!): Connector`, `connectorExecutions(connectorId: ID!, status: ConnectorExecutionState, limit: Int, cursor: String): [ConnectorExecution!]!`, `connectorExecution(id: ID!): ConnectorExecution`. Cursor is opaque to clients (provider semantics: started_at-derived). **Decision:** flat-list pagination matching `routineExecutions` (no `Page` wrapper). Thinkwork has multiple pagination shapes (`EvalRunsPage`, `TenantEntityFacetEdge`, flat-list) — picking the closest semantic precedent (execution-row queries) over a generic Page wrapper.
- All resolvers scope by `ctx.auth.tenantId` (with `resolveCallerTenantId(ctx)` fallback per existing pattern, imported from `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`). NO operator bypass in this child plan — operator surface lives in master plan U10.
- Pagination matches existing thinkwork convention (verify at execution time; mirror `routineExecutions` if present).
- Codegen sweep at end: `pnpm schema:build` regenerates `terraform/schema.graphql`; `pnpm --filter @thinkwork/database-pg codegen` and the four consumers (`apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`) re-run codegen.

**Patterns to follow:**
- `packages/database-pg/graphql/types/routines.graphql` (or similar — verify pattern at execution time)
- `packages/api/src/graphql/resolvers/routines/query.ts` (precedent for tenant-scoped read resolvers with pagination)
- `packages/api/src/graphql/utils.ts` `resolveCallerTenantId(ctx)` pattern

**Test scenarios:**
- Happy path: `connectors` query returns rows for the calling tenant; rows for other tenants are not visible.
- Happy path: `connector(id)` returns the row when calling tenant matches; returns null when tenant mismatches (not a 404 — masks existence).
- Happy path: `connectorExecutions(connectorId)` returns paginated executions; cursor advances correctly across pages.
- Edge case: empty result for tenant with no connectors.
- Edge case: filter by `status='active'` returns only active connectors.
- Edge case: connector deleted (cascade from tenant) does not appear in query results.
- Error path: caller without resolved tenantId rejected with `unauthorized`.
- Error path: caller queries non-existent connector ID returns null (not error).
- Integration: real-DB integration test covers the tenant-isolation invariant — two seeded tenants each with a connector; tenant A's caller cannot read tenant B's connector via any query.
- Integration: pagination cursor stable across new inserts (cursor-based, not offset-based).

**Verification:**
- All queries return tenant-scoped data; cross-tenant reads impossible via the API surface.
- Codegen propagates new types to `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` without manual edits.
- All tests pass.

---

### U4. GraphQL admin mutations: create / update / pause / resume / archive

**Goal:** Add admin-gated mutations for connector lifecycle. Every mutation calls `requireTenantAdmin(ctx, tenantId)` before any side effect. No live dispatch behavior — mutations only write to the `connectors` table; no Lambda or background process reads them yet.

**Requirements:** R4, R7; PR2, PR7

**Dependencies:** U1 (tables exist), U3 (SDL exists).

**Files:**
- Modify: `packages/database-pg/graphql/types/connectors.graphql` (add mutation types + inputs)
- Create: `packages/api/src/graphql/resolvers/connectors/mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts` (register mutation resolvers)
- Test: `packages/api/src/graphql/resolvers/connectors/__tests__/mutation.test.ts` (new)
- Test: `packages/api/test/integration/connector-mutation.test.ts` (new — integration against real DB + Cognito stub)

**Approach:**
- Mutations: `createConnector(input: CreateConnectorInput!): Connector`, `updateConnector(id: ID!, input: UpdateConnectorInput!): Connector`, `pauseConnector(id: ID!): Connector`, `resumeConnector(id: ID!): Connector`, `archiveConnector(id: ID!): Connector`.
- Every mutation's first action is `requireTenantAdmin(ctx, tenantId)`. Mutations also resolve the connector's `tenant_id` from the row (for update/pause/resume/archive) and re-check tenant match before any UPDATE.
- `createConnector` validates `dispatch_target_type` and `dispatch_target_id` cross-reference: if `dispatch_target_type='agent'`, verify `agents.id = dispatch_target_id AND tenant_id = caller_tenant`; same for `routine` / `hybrid_routine`. Application-layer validation (no DB FK).
- `createConnector` validates `config` JSONB shape against the connector type's expected fields. v0: lightweight schema check (fields present, types match). Catalog-driven validation lands in master plan U2 child plan; U1 ships a stub validator that accepts any non-null jsonb.
- `pauseConnector` / `resumeConnector` toggle `enabled` boolean (idempotent) AND set `status` accordingly (`active` ↔ `paused`).
- `archiveConnector` is soft-delete: sets `status='archived'` and `enabled=false`. Row persists; partial-index-scoped queries skip archived rows.
- Mutation audit log: emit `connector_mutation_audit` event with `actor_sub`, `actor_email`, `tenant_id`, `connector_id`, `mutation`, `outcome` via `ctx.logger.info` (CloudWatch Logs Insights audit pattern; no Aurora `operator_actions` table per master plan scope).
- All mutations return the updated `Connector` row.

**Execution note:** Test-first for the `requireTenantAdmin` gate behavior — the institutional rule is load-bearing and the failure mode (cross-tenant write) is severe. Add a real-DB integration test that explicitly attempts cross-tenant mutation and asserts rejection.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/authz.ts` `requireTenantAdmin` invocation
- `packages/api/src/graphql/resolvers/routines/mutation.ts` (or similar — precedent for tenant-scoped mutations, audit logging)
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`

**Test scenarios:**
- Happy path: customer admin creates a connector for their tenant; returned row matches input + has `status='active'` + `enabled=true`.
- Happy path: pauseConnector flips `status='paused'` + `enabled=false`; resumeConnector flips back.
- Happy path: archiveConnector sets `status='archived'`; subsequent `connectors` query (without explicit archived filter) does NOT return the row.
- Edge case: createConnector with duplicate `(tenant_id, name)` rejected with composite-unique-violation surfaced as a typed error.
- Edge case: createConnector with `dispatch_target_id` referencing an agent in a different tenant rejected with `invalid_dispatch_target` (cross-tenant reference forbidden at the application layer).
- Edge case: pauseConnector on already-paused connector is idempotent (no error, no audit double-write).
- Edge case: archiveConnector on already-archived connector is idempotent.
- Error path: caller without admin role rejected with `forbidden` BEFORE any DB read.
- Error path: caller from different tenant attempting to update another tenant's connector rejected with `forbidden` AFTER tenant_id resolution but BEFORE UPDATE.
- Error path: createConnector with invalid `dispatch_target_type='lambda'` rejected by SQL CHECK.
- Error path: createConnector with non-existent `dispatch_target_id` rejected with `dispatch_target_not_found`.
- Error path: archiveConnector on connector with active `connector_executions` succeeds (archival doesn't prevent in-flight runs from completing; U10 operator-kill is the cancellation path).
- Integration: Covers AE6. Two tenants with overlapping connector configurations; cross-tenant mutations rejected; same-tenant mutations succeed; per-tenant isolation holds.
- Integration: audit log entry emitted for every successful mutation; `actor_sub`, `actor_email`, `tenant_id`, `connector_id`, `mutation`, `outcome` all present.
- Integration: caller without `tenant_members.role='admin'` row rejected.

**Verification:**
- All mutations reject without admin role.
- Cross-tenant mutations rejected.
- Audit log entries present for every successful mutation.
- All tests pass.

---

## System-Wide Impact

- **Interaction graph:** This unit adds new tables and a new GraphQL surface but does not modify any existing Lambda, EventBridge schedule, or callback pathway. Master plan U2 introduces the first reader (`connector-poll-handler` Lambda).
- **Error propagation:** GraphQL errors propagate through existing Yoga + envelop masked-errors plugin. No new error types beyond standard typed `forbidden` / `not_found` / `validation_error` / `composite_unique_violation`.
- **State lifecycle risks:** None at U1's scope — schema-only. The `connector_executions` row lifecycle activates at master plan U2 when the chassis is wired.
- **API surface parity:** GraphQL schema gains queries + mutations. Mobile app does NOT consume these surfaces in v0 (connector authoring is admin-only per origin R22). REST surface unchanged. AppSync subscription schema (`terraform/schema.graphql`) regenerates via `pnpm schema:build`; if any new types should be subscribable, that's a master plan U10 decision (operator real-time updates), not U1.
- **Integration coverage:** Real-DB integration tests cover the tenant-isolation invariant (cross-tenant reads/writes rejected). Real-Cognito-token integration tests are out of scope here — Cognito stub for the `requireTenantAdmin` gate is sufficient at U1 since the auth model itself is unchanged (we use the existing `tenant_members.role` pattern).
- **Unchanged invariants:** Existing `routines`, `routine_executions`, `scheduled_jobs`, `threads`, `thread_turns`, `webhooks`, `connect_providers`, `connections`, `credentials`, `tenant_members`, `agents`, `tenants` schemas are untouched. The only existing-schema mutation is `tenant_entity_external_refs.source_kind` CHECK extension (U2 of this child plan).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Migration prefix collision with another in-flight branch in thinkwork | Pick prefix at execution time; rebase against `main` immediately before merging; resolve any prefix collision with a small renumber. |
| `tenant_entity_external_refs` rollback after data with new `source_kind` exists | Document explicitly in rollback file header: "rollback requires DELETE FROM tenant_entity_external_refs WHERE source_kind IN ('tracker_issue','tracker_ticket') first; rollback SQL alone will fail CHECK." |
| `dispatch_target_id` polymorphic FK creates orphan rows if target deleted | Application-layer cascade in target-deletion mutations (out of scope for U1 — flagged as a follow-up for the agents/routines mutation owners; `connector_executions` ON DELETE RESTRICT on `connector_id` prevents accidental connector deletion mid-flight). |
| Codegen sweep across 4 consumers fragile if any consumer is in a broken state | AGENTS.md (line 67) names the four consumers (`apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`) as a set without specifying an order. In practice, run them sequentially and fail loudly if any consumer's codegen errors. There is no implicit dependency order; the SDL update in `packages/database-pg/graphql/types/connectors.graphql` is the upstream source, and consumers re-run codegen against the regenerated `terraform/schema.graphql`. |
| New `connectors.config` JSONB shape evolves before catalog validator lands (master plan U2) | v0 stub validator accepts any jsonb; U2's child plan introduces catalog-driven validation. Customers cannot configure connectors via admin UX until master plan U9, so the temporary loose validation has no customer-facing exposure. |

---

## Documentation / Operational Notes

- Add `connectors` and `connector_executions` table descriptions to whatever schema-doc surface thinkwork maintains (verify at execution time — likely `docs/` or generated from drizzle introspection).
- After landing, update master plan `(symphony) docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md` U1 section's status (mark as `landed` or update reference). The master plan tracking is informal — git log + commit messages are the canonical record.
- No runbook changes — operator-facing surfaces land in master plan U10.
- No alarm changes — observability lands in master plan U5.

---

## Sources & References

- **Master plan:** [`(symphony) docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md`](../../../symphony/docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md) — U1 master unit
- **Origin requirements:** [`(symphony) docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md`](../../../symphony/docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md)
- Schema patterns:
  - `packages/database-pg/src/schema/routines.ts` — engine partition pattern
  - `packages/database-pg/src/schema/routine-executions.ts` — execution-row shape, bigint cents
  - `packages/database-pg/src/schema/scheduled-jobs.ts` — freeform `trigger_type` precedent
  - `packages/database-pg/src/schema/integrations.ts` — `connections` + `credentials` reuse
  - `packages/database-pg/src/schema/tenant-entity-external-refs.ts` — verified CHECK enum source
- Migration convention: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Auth gate convention: `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
- Inert-to-live seam: `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
- AGENTS.md (Drizzle TS mirror SQL rule, codegen sweep order)
