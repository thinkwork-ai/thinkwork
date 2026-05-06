---
title: "feat: ThinkWork Computer phase one foundation"
type: feat
status: completed
date: 2026-05-06
---

# feat: ThinkWork Computer phase one foundation

## Overview

Build the Phase 1 foundation for ThinkWork Computer: first-class Computer persistence, typed Templates, Computer GraphQL/API contracts, and a rollback-safe migration path from existing user-paired Agents into one Computer per user.

This plan intentionally scopes to Phase 1 / U1-U3 from the broader ThinkWork Computer strategy. It does not provision ECS/Fargate/EFS runtime services, Google Workspace CLI orchestration, admin UI navigation, delegation execution, or docs/product copy. Those later phases should build on the Computer domain model introduced here.

---

## Problem Frame

The current Agent model is overloaded: an Agent can represent a user-paired durable workplace, a delegated worker, a template instance, a workspace owner, a schedule target, and a runtime invocation target. Phase 1 separates the durable user-owned object from delegated workers by introducing Computers as the active product/API model while preserving existing Agent rows for compatibility and rollback.

---

## Requirements Trace

- R1. Computers replace user-specific Agents as the primary durable model for new work.
- R2. Each human user has at most one active Computer per tenant in this phase.
- R3. Existing user-paired Agents can be dry-run migrated into Computers without deleting source Agent rows.
- R4. Agents remain available as delegated/shared workers after migration.
- R5. Templates are typed as Computer Templates or Agent Templates without discarding the existing template substrate.
- R6. Computer APIs enforce tenant/user ownership and do not expose another user's Computer to normal tenant members.
- R7. Migration preserves enough provenance to rollback or inspect the source Agent.

---

## Scope Boundaries

- No ECS, Fargate, EFS, runtime heartbeat, or always-on Computer service provisioning.
- No Google Workspace CLI/runtime work.
- No admin navigation or product copy changes beyond generated API types if required.
- No full cleanup of legacy Agent-named historical APIs/tables.
- No deletion of migrated source Agent rows.

---

## Key Technical Decisions

- **Create `computers` as a first-class table.** A table rename would force every legacy `agent_id` reference to move at once. Phase 1 introduces Computers as the active owner while preserving Agent history.
- **Use `agent_templates.template_kind` in v1.** Existing templates already hold runtime, model, guardrail, skills, tools, and workspace defaults. A typed field is the lowest-risk split for Computer Templates vs Agent Templates.
- **Add Computer-owned queue/event tables now.** Later runtime work should not overload `agent_wakeup_requests` for Computer-first work. Phase 1 can create the tables and contracts even before ECS consumes them.
- **Prefer dry-run-first migration.** Real tenant data may have multiple user-paired Agents per user. Migration must report conflicts before apply.
- **Keep Agent APIs compatible but filter semantics can evolve.** Phase 1 may add explicit include options for migration visibility rather than hiding data with an irreversible behavior change.

---

## Implementation Units

- U1. **Add Computer and typed Template data model**

**Goal:** Introduce Computer persistence, typed Templates, and schema support for future Computer tasks/events/snapshots/delegations.

**Requirements:** R1, R2, R4, R5, R7.

**Dependencies:** None.

**Files:**

- Create: `packages/database-pg/src/schema/computers.ts`
- Modify: `packages/database-pg/src/schema/index.ts`
- Modify: `packages/database-pg/src/schema/agent-templates.ts`
- Create: `packages/database-pg/drizzle/NNNN_thinkwork_computers.sql`
- Test: `packages/database-pg/src/schema/computers.test.ts`

**Approach:**

- Add `computers` with tenant, owner user, template, name/slug, lifecycle/runtime status fields, workspace/runtime metadata placeholders, budget fields, migration provenance, and timestamps.
- Add unique active Computer invariant for `(tenant_id, owner_user_id)`.
- Add `computer_tasks`, `computer_events`, `computer_snapshots`, and `computer_delegations` with tenant/computer foreign keys and status metadata for later runtime/API work.
- Add `agent_templates.template_kind` with `computer` and `agent` values, defaulting existing rows to `agent`.
- Export the new schema from `packages/database-pg/src/schema/index.ts`.

**Patterns to follow:**

- `packages/database-pg/src/schema/agents.ts`
- `packages/database-pg/src/schema/agent-workspace-events.ts`
- `packages/database-pg/src/schema/sandbox-invocations.ts`

**Test scenarios:**

- Happy path: a Computer can be defined for one tenant/user/template.
- Edge case: a second active Computer for the same tenant/user violates the unique invariant.
- Happy path: an Agent Template defaults to `agent` template kind.
- Happy path: a Computer Template can be represented by `template_kind = 'computer'`.
- Integration: Computer task/event/snapshot/delegation tables reference the owning Computer and tenant.

**Verification:**

- Database package typecheck passes.
- Migration SQL is explicit about new tables, indexes, and template kind backfill.

---

- U2. **Add Computer GraphQL/API contracts**

**Goal:** Expose Computers and typed Templates through GraphQL contracts usable by admin/mobile/CLI clients.

**Requirements:** R1, R2, R5, R6.

**Dependencies:** U1.

**Files:**

- Create: `packages/database-pg/graphql/types/computers.graphql`
- Modify: `packages/database-pg/graphql/types/agent-templates.graphql`
- Modify: `packages/api/src/graphql/resolvers/index.ts`
- Create: `packages/api/src/graphql/resolvers/computers/index.ts`
- Create: `packages/api/src/graphql/resolvers/computers/computers.query.ts`
- Create: `packages/api/src/graphql/resolvers/computers/myComputer.query.ts`
- Create: `packages/api/src/graphql/resolvers/computers/computer.query.ts`
- Create: `packages/api/src/graphql/resolvers/computers/createComputer.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/computers/updateComputer.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/computers/computers.query.test.ts`
- Test: `packages/api/src/graphql/resolvers/computers/createComputer.mutation.test.ts`

**Approach:**

- Add `Computer`, lifecycle enums, query inputs, and create/update inputs in a new GraphQL type file.
- Add `TemplateKind` and `templateKind` to Agent Template GraphQL types and create/update inputs.
- Add resolvers for `myComputer`, admin `computers(tenantId)`, `computer(id)`, `createComputer`, and `updateComputer`.
- Tenant members can read their own Computer. Tenant owners/admins can list/read tenant Computers. Mutations require tenant admin/owner unless implementation finds a narrower existing permission helper.
- Use `resolveCallerTenantId(ctx)` and existing membership helpers so Google-federated callers do not depend on `ctx.auth.tenantId`.

**Patterns to follow:**

- `packages/api/src/graphql/resolvers/agents/agents.query.ts`
- `packages/api/src/graphql/resolvers/templates/createAgentTemplate.mutation.ts`
- `packages/api/src/graphql/resolvers/core/authz.ts`

**Test scenarios:**

- Happy path: a user querying `myComputer` receives their Computer.
- Happy path: a tenant admin listing `computers(tenantId)` receives Computers for that tenant.
- Error path: a normal tenant member cannot read another user's Computer by ID.
- Error path: creating a second active Computer for the same user is rejected.
- Integration: GraphQL schema loads with `Computer` and `TemplateKind` definitions.

**Verification:**

- API package tests and typecheck pass for Computer resolvers.
- Generated schema includes Computer and typed Template fields.

---

- U3. **Build Agent-to-Computer migration gates**

**Goal:** Provide dry-run and apply helpers/handler for migrating existing user-paired Agents into Computers without deleting source rows.

**Requirements:** R1, R2, R3, R4, R5, R7.

**Dependencies:** U1, U2.

**Files:**

- Create: `packages/api/src/lib/computers/migration.ts`
- Create: `packages/api/src/lib/computers/migration-report.ts`
- Create: `packages/api/src/handlers/migrate-agents-to-computers.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Test: `packages/api/src/lib/computers/migration.test.ts`
- Test: `packages/api/src/handlers/migrate-agents-to-computers.test.ts`

**Approach:**

- Dry-run groups Agents by `(tenant_id, human_pair_id)` and reports straightforward migrations, multiple candidates, missing template data, slug collisions, unsupported source states, and existing Computer conflicts.
- Apply creates one Computer per user from the selected primary Agent and records `migrated_from_agent_id`.
- Source Agent rows are preserved and marked only with compatible metadata/status if needed for filtering.
- Re-running apply is idempotent when the Computer already exists from the same source Agent.
- Expose the handler as a privileged migration Lambda and wire it into build/deploy config.

**Patterns to follow:**

- `packages/api/src/handlers/migrate-existing-agents-to-overlay.ts`
- `packages/api/src/handlers/migrate-agents-to-fat.ts`
- `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`

**Test scenarios:**

- Happy path: one user-paired Agent dry-runs and applies into one Computer.
- Edge case: two user-paired Agents for one user produce a conflict in dry-run.
- Edge case: an Agent without `human_pair_id` is ignored as a delegated/shared Agent candidate.
- Error path: apply refuses unresolved conflicts unless explicitly overridden by the migration API.
- Idempotency: re-running apply after success does not create duplicate Computers.
- Rollback support: migration report includes enough provenance to map Computer back to source Agent.

**Verification:**

- Dry-run produces actionable structured output for dev/staging data.
- Apply can migrate a fixture tenant and preserve source Agent rows.

---

## System-Wide Impact

- **Database:** Adds first-class Computer tables and template kind semantics.
- **GraphQL/API:** Adds Computer queries/mutations while preserving existing Agent APIs.
- **Migration:** Introduces a controlled path to move user-paired Agents into Computers without irreversible source-row deletion.
- **Generated clients:** Admin/mobile/CLI codegen may need regeneration after schema changes.
- **Later phases:** ECS/EFS runtime, Google CLI orchestration, delegation execution, UI navigation, cost reporting, and docs should build on these contracts.

---

## Risks & Mitigations

| Risk                                                       | Mitigation                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Existing tenants have multiple user-paired Agents per user | Dry-run reports conflicts and apply refuses unresolved groups                    |
| Template kind breaks existing Agent Template creation      | Default existing and omitted values to `agent`; test create/update compatibility |
| Computer APIs expose cross-user data                       | Use tenant membership and owner checks in every resolver                         |
| Full ThinkWork Computer scope leaks into Phase 1           | Keep ECS/runtime/UI/docs out of this PR and make later dependencies explicit     |

---

## Success Metrics

- `computers` and supporting Computer work tables exist with tenant/user ownership constraints.
- Existing Agent Templates continue to work and default to `agent` kind.
- GraphQL exposes Computer read/create/update contracts with ownership checks.
- Migration dry-run/apply can turn a fixture user-paired Agent into one Computer idempotently.
