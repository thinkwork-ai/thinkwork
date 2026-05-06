---
title: feat: Connector admin mutations
type: feat
status: active
date: 2026-05-06
origin: ../../../symphony/docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md
master_plan: ../../../symphony/docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md
child_plan_context: docs/plans/2026-05-05-001-feat-thinkwork-connector-data-model-plan.md
---

# feat: Connector admin mutations

## Overview

Add the U4 GraphQL mutation surface for the connector data-model foundation: customer admins can create, update, pause, resume, and archive connector configuration rows. This lands the write API only. It remains inert: no Lambda, poller, scheduler, or Flue dispatch process reads these rows yet.

---

## Problem Frame

U1 and U2 created the durable connector tables and external-ref enum extension; U3 exposed tenant-scoped read queries. The next foundation step is a write API that lets admin surfaces manage connector lifecycle safely while preserving the master plan's multi-tenant connector-first architecture. The important risk is not complicated business logic; it is tenant isolation. Every mutation must gate with `requireTenantAdmin(ctx, tenantId)` before writing, with tenant IDs derived from the create input or from the target row.

---

## Requirements Trace

- R4. Connector framework abstraction with a uniform configuration surface.
- R6. Connectors dispatch to multiple target shapes: `agent`, `routine`, and `hybrid_routine`.
- R7. Connector framework is multi-tenant from day one.
- R22. Customer admins configure connectors, author routines, and bind connectors to dispatch targets through admin surfaces.
- PR2. Every new GraphQL mutation calls `requireTenantAdmin(ctx, tenantId)` before any side effect.
- PR7. This unit ships inert: mutations only write `connectors`; no background process consumes connector rows.

**Origin actors:** A1 (customer admin), A5 (connector), A6 (agent runtime), A7 (routine engine)
**Origin flows:** F5 (connector configuration)
**Origin acceptance examples:** AE6 (per-tenant isolation)

---

## Scope Boundaries

- No admin SPA Symphony/connectors page in this PR; that is the first UI checkpoint after this API exists.
- No `scheduled_jobs` provisioning, EventBridge schedule creation, Lambda dispatch, Linear adapter, or Flue invocation.
- No catalog-driven connector config validator yet. The v0 mutation surface should accept `AWSJSON` config and preserve it as JSONB after basic JSON parsing.
- No operator bypass or cross-tenant operator mutation surface; master-plan operator work lands later.

### Deferred to Follow-Up Work

- Admin nav/page for "Symphony" under Dashboard.
- Connector chassis that reads connector rows and creates `connector_executions`.
- Linear adapter and end-to-end "Linear task through Flue" checkpoint.

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/graphql/types/connectors.graphql` contains the U3 read SDL and lower-snake enum values that must be extended rather than replaced.
- `packages/api/src/graphql/resolvers/connectors/query.ts` contains the read resolver tenant-scoping and `snakeToCamel` mapping style to mirror for returned rows.
- `packages/api/src/graphql/resolvers/core/authz.ts` exposes `requireTenantAdmin(ctx, tenantId)`.
- `packages/api/src/graphql/resolvers/teams/createTeam.mutation.ts` and `updateTeam.mutation.ts` show create-input tenant gating and row-derived update gating.
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts` shows arg-derived `requireTenantAdmin` before insert work.
- `packages/database-pg/src/schema/connectors.ts` defines writable columns and the application-managed `updated_at` convention.
- `packages/database-pg/src/schema/routines.ts`, `packages/database-pg/src/schema/routine-asl-versions.ts`, and `packages/database-pg/src/schema/agents.ts` are the validation targets for `dispatchTargetType`.

### Institutional Learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` is mandatory for this unit: create mutations gate on input tenant, existing-row mutations gate on row-derived tenant, and the gate must happen before writes.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` supports shipping this as a structural write API before connector dispatch behavior exists.

### External References

External research skipped. This is an internal GraphQL CRUD/authz surface with strong local patterns.

---

## Key Technical Decisions

- **Mutation names:** `createConnector`, `updateConnector`, `pauseConnector`, `resumeConnector`, and `archiveConnector`.
- **Create gate source:** `createConnector(input)` gates with `requireTenantAdmin(ctx, input.tenantId)` before validation writes or insert.
- **Existing-row gate source:** update/pause/resume/archive first load the connector's `tenant_id`; missing rows throw `NOT_FOUND`; then `requireTenantAdmin(ctx, row.tenant_id)` gates before the update.
- **Target validation:** create and target-changing updates validate that the dispatch target exists in the same tenant. `agent` checks `agents`; `routine` and `hybrid_routine` check `routines`. Hybrid-specific engine validation is deferred until the chassis/catalog defines the exact routine partition semantics.
- **Config shape:** `config` remains `AWSJSON` and is parsed to JSONB. Invalid JSON fails the mutation. Type-specific validation is deferred to the connector catalog.
- **Lifecycle writes:** pause/resume/archive update only connector lifecycle fields and `updated_at`. Pause sets `status='paused'` and `enabled=false`; resume sets `status='active'` and `enabled=true`; archive sets `status='archived'` and `enabled=false`.
- **Audit:** use structured `console.info`/logger-style output for connector mutation audit events. Do not add an Aurora audit table in this PR.

---

## Open Questions

### Resolved During Planning

- **Should U4 provision schedules or call a Lambda?** No. This remains inert.
- **Should `config` be catalog-validated in U4?** No. Basic JSON parsing only; catalog validation belongs with the connector chassis/catalog work.
- **Should update allow changing dispatch target?** Yes, with same-tenant target validation, because the admin configuration surface needs editable bindings.

### Deferred to Implementation

- Exact local helper names for JSON parsing, error construction, and audit logging should follow the nearby resolver style once implementation starts.
- Whether `hybrid_routine` needs a stricter routine-engine predicate is deferred until implementation inspects the current routine schema and tests; if there is no reliable persisted hybrid marker, validate tenant existence only.

---

## Implementation Units

- U1. **GraphQL mutation contract**

**Goal:** Extend the connector SDL with mutation inputs and mutation fields while preserving U3 read types and lower-snake enum values.

**Requirements:** R4, R6, R22, PR7

**Dependencies:** U3 read SDL is present on `main`.

**Files:**
- Modify: `packages/database-pg/graphql/types/connectors.graphql`
- Modify: `apps/cli/src/gql/graphql.ts`
- Modify: `apps/admin/src/gql/graphql.ts`
- Modify: `apps/mobile/lib/gql/graphql.ts`

**Approach:**
- Add `CreateConnectorInput` with required `tenantId`, `type`, `name`, `dispatchTargetType`, and `dispatchTargetId`; optional `description`, `connectionId`, `config`, `enabled`, `createdByType`, and `createdById`.
- Add `UpdateConnectorInput` with optional editable fields: `type`, `name`, `description`, `connectionId`, `config`, `dispatchTargetType`, `dispatchTargetId`, and `enabled`.
- Add `extend type Mutation` fields for create/update/pause/resume/archive.
- Regenerate the available GraphQL consumers after SDL changes.

**Patterns to follow:**
- `packages/database-pg/graphql/types/connectors.graphql`
- `packages/database-pg/graphql/types/teams.graphql`
- `packages/database-pg/graphql/types/routines.graphql`

**Test scenarios:**
- Integration: GraphQL schema contract includes the five connector mutation fields and all connector mutation input types.
- Integration: generated client types expose the new inputs and mutations without changing existing connector query types.

**Verification:**
- Schema build and consumer codegen complete; generated types compile in touched packages.

---

- U2. **Admin mutation resolvers**

**Goal:** Implement create/update/pause/resume/archive resolvers with tenant-admin gating, target validation, lifecycle updates, and inert behavior.

**Requirements:** R4, R6, R7, R22, PR2, PR7

**Dependencies:** U1.

**Files:**
- Create: `packages/api/src/graphql/resolvers/connectors/mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/connectors/index.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts`
- Test: `packages/api/src/graphql/resolvers/connectors/mutation.test.ts`

**Approach:**
- `createConnector` gates on `input.tenantId`, validates same-tenant dispatch target, parses optional JSON config, inserts a row, and returns `snakeToCamel(row)`.
- `updateConnector` loads `{tenant_id, dispatch_target_type, dispatch_target_id}` by connector id, throws `NOT_FOUND` when absent, gates on row tenant, validates any changed dispatch target against that same tenant, applies only provided fields, bumps `updated_at`, and returns the updated row.
- `pauseConnector`, `resumeConnector`, and `archiveConnector` share a row-derived helper that loads target tenant, gates, updates lifecycle fields idempotently, bumps `updated_at`, and returns the row.
- Write audit logs after successful mutations with tenant id, connector id, mutation name, and outcome.
- Keep all operations limited to `connectors`; no `connector_executions`, `scheduled_jobs`, Lambda invocation, or EventBridge side effects.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/teams/updateTeam.mutation.ts`
- `packages/api/src/graphql/resolvers/teams/deleteTeam.mutation.ts`
- `packages/api/src/graphql/resolvers/connectors/query.ts`
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`

**Test scenarios:**
- Happy path: admin creates a connector for their tenant and receives a camelCased connector payload with persisted JSON config.
- Happy path: admin updates connector name/description/config and `updatedAt` changes.
- Happy path: pause/resume/archive are idempotent and set the expected `status`/`enabled` combination.
- Edge case: update with no provided fields still bumps `updatedAt` only if the existing resolver convention supports no-op updates; otherwise it should return the current row without unintended field changes.
- Error path: non-admin caller cannot create a connector for a tenant.
- Error path: cross-tenant admin cannot update/pause/resume/archive a connector from another tenant.
- Error path: update/archive of an unknown connector returns `NOT_FOUND`.
- Error path: create/update with a dispatch target id from another tenant fails before insert/update.
- Error path: invalid `config` JSON fails the mutation and does not write a row.
- Integration: mutation resolvers do not call scheduler, Lambda, or execution tables.

**Verification:**
- New resolver tests prove auth order, tenant isolation, target validation, lifecycle state transitions, and inert behavior.

---

- U3. **Contract integration and regression sweep**

**Goal:** Ensure the new mutation surface is wired into the API contract and does not regress U3 read behavior.

**Requirements:** R7, PR2, PR7

**Dependencies:** U1, U2.

**Files:**
- Test: `packages/api/src/__tests__/graphql-contract.test.ts`
- Test: `packages/api/src/graphql/resolvers/connectors/query.test.ts`
- Test: `packages/api/src/graphql/resolvers/connectors/mutation.test.ts`

**Approach:**
- Keep U3 read resolver behavior unchanged: tenant-scoped reads, archived excluded by default, OAuth tenant fallback for reads.
- Confirm the merged resolver registry exposes both connector queries and connector mutations.
- Run package-level API typecheck/build and full repo checks where available.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/index.ts`
- `packages/api/src/__tests__/graphql-contract.test.ts`

**Test scenarios:**
- Integration: GraphQL contract test still passes with the new mutation fields.
- Integration: U3 connector query tests still pass after adding mutation wiring.
- Regression: connector mutation wiring does not shadow existing mutation names.

**Verification:**
- API tests, typecheck, and build pass; full repo test suite passes or any pre-existing tooling blocker is documented in the PR.

---

## System-Wide Impact

- **Interaction graph:** Admin/CLI/mobile GraphQL clients can call connector mutations; the API writes only `connectors`.
- **Error propagation:** auth failures surface through `requireTenantAdmin`; missing rows surface as `NOT_FOUND`; malformed JSON and invalid targets surface as GraphQL errors before writes.
- **State lifecycle risks:** lifecycle mutations are soft state flips; archived rows persist for audit and U3 read filtering continues to hide archived rows by default.
- **API surface parity:** GraphQL generated types update for CLI, admin, and mobile. No REST or AppSync subscription changes are required beyond normal schema generation.
- **Integration coverage:** target validation crosses connector rows with `agents`/`routines`, so tests need to assert same-tenant validation.
- **Unchanged invariants:** no dispatch side effects, no scheduled job provisioning, no connector execution creation, and no operator bypass.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cross-tenant connector mutation | Use row-derived `requireTenantAdmin` for existing connectors and arg-derived gate for create; test both denial paths. |
| Dispatch target points at another tenant | Validate target rows by `(id, tenant_id)` before insert/update. |
| Mutation accidentally activates connector execution | Keep resolver imports scoped to DB tables and auth utilities; test that no scheduler/Lambda/execution write path is touched. |
| Future catalog validation conflicts with freeform v0 config | Store config as JSONB unchanged and defer type-specific validation to catalog/chassis PR. |

---

## Documentation / Operational Notes

- PR description should call out that U4 is still inert. The first demo checkpoint needs follow-up UI plus connector chassis work before Linear can drive Flue.
- No deploy runbook change is required for this PR beyond the normal GraphQL schema/codegen workflow.

---

## Sources & References

- **Origin document:** [../../../symphony/docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md](../../../symphony/docs/brainstorms/2026-05-05-thinkwork-connector-platform-evolution-requirements.md)
- **Master plan:** [../../../symphony/docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md](../../../symphony/docs/plans/2026-05-05-004-feat-thinkwork-connector-platform-evolution-plan.md)
- Related code: `packages/database-pg/graphql/types/connectors.graphql`
- Related code: `packages/api/src/graphql/resolvers/connectors/query.ts`
- Related code: `packages/api/src/graphql/resolvers/core/authz.ts`
- Institutional learning: `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
