---
title: "feat: Routines rebuild Phase A — substrate"
type: feat
status: active
date: 2026-05-01
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Routines rebuild Phase A — substrate

## Summary

Land the foundations for the Step Functions Routines rebuild: greenfield Terraform module (IAM execution role with tenant ABAC, log groups, S3 routine-output bucket), four new Drizzle tables (`routine_executions`, `routine_step_events`, `routine_asl_versions`, `routine_approval_tokens`), GraphQL schema additions with codegen across consumers, the v0 recipe catalog as an in-repo TS module, and the `routine-asl-validator` Lambda. Nothing user-visible — pure substrate that unblocks Phase B runtime work.

---

## Problem Frame

Phase A of the master plan (`docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`). The Routines rebuild needs Step Functions infrastructure, persistent state for runs/steps/versions/HITL tokens, GraphQL types for the new run UI to query, the canonical recipe definitions every later phase relies on, and a server-side validator to gate LLM-emitted ASL. None of these exist today; everything is greenfield.

---

## Requirements

All R-IDs trace back to the origin requirements doc (`docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`).

- R6. Locked v0 recipe set (defined in U4).
- R7. Invocation recipes expose existing tenant inventory (`tenantToolInventory` resolver in U4).
- R8. `python()` IAM and S3 offload paths (substrate in U1; Lambda comes in Phase B U6).
- R9. Recipes ThinkWork-eng-owned, defined in repo (U4).
- R10. Publish-time validation pipeline (U5).
- R11, R12, R13, R14, R15, R16, R17. Substrate that the run UI and HITL flows will use (U1 IAM, U2 schema, U3 GraphQL types).
- R20. `routine_invoke` cycle detection in the validator (U5).

**Origin actors:** A4 (ThinkWork engineer) — primary actor for this phase.
**Origin flows:** None directly exercised in Phase A; substrate only.
**Origin acceptance examples:** AE3, AE5 are partially testable in U5 (validator unit tests).

---

## Scope Boundaries

- All work from Phase B (runtime), Phase C (authoring), Phase D (UI), Phase E (cleanup) — explicitly deferred to their own phase plans.
- No publish flow, no execution-start swap, no HITL wiring (Phase B).
- No mobile or admin UI changes (Phase C / D).
- No deprecation of legacy Python routines (Phase E).
- Origin Scope Boundaries carried forward unchanged; see master plan.

### Deferred to Follow-Up Work

- Phase B (Runtime) — `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md`
- Phase C (Authoring) — `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md`
- Phase D (UI) — `docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md`
- Phase E (Cleanup + observability) — `docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md`

---

## Context & Research

Defer to the master plan's "Context & Research" section for the full repo-research summary and 14 institutional learnings. The Phase-A-specific highlights:

- `terraform/modules/app/agentcore-code-interpreter/main.tf` — closest precedent for a stage-substrate Terraform module
- `terraform/modules/app/job-triggers/main.tf` — closest precedent for IAM-role-for-AWS-managed-service
- `packages/database-pg/src/schema/scheduled-jobs.ts` — analogous append-only event-table shape
- `packages/database-pg/src/schema/inbox-items.ts` — tenant-scoped + decision-shape pattern (reused by `routine_approval_tokens`)
- `packages/api/src/handlers/sandbox-quota-check.ts` and `sandbox-invocation-log.ts` — narrow REST + Bearer auth (template for the validator Lambda)
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — `-- creates: public.X` headers + `db:migrate-manual` gate
- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — fresh-worktree bootstrap

---

## Key Technical Decisions

Carry the following from the master plan into Phase A:

- **Standard Step Functions workflows** (Express deferred). Substrate provisions for Standard.
- **Single execution role with tenant ABAC tags**, not per-tenant roles. U1 implements this.
- **Step Functions versions+aliases as ASL source of truth**; `routine_asl_versions` mirrors for query/audit. U2 carries this contract in the schema.
- **Dedicated `routine_executions` + `routine_step_events` tables**, not extension of `thread_turns`. U2.
- **`routine_approval_tokens` mapping table with `consumed` boolean**, partial UNIQUE on (execution_id, node_id) WHERE consumed=false. U2.
- **`routines.engine` column** (`legacy_python` | `step_functions`) as the partition between old and new code paths. U2.
- **JSONata query language** for the recipe catalog's ASL emitters. U4.
- **Validator is a server-side Lambda** the chat builder will also call. U5.
- **Service-to-service callbacks on narrow REST endpoints with Bearer `API_AUTH_SECRET`.** U5 follows this template.

---

## Open Questions

### Resolved During Planning

All Phase A open questions resolved in the master plan's "Open Questions — Resolved During Planning" section.

### Deferred to Implementation

- Whether `tenantToolInventory` returns a discriminated-union shape or a flat list with `kind` field — decide while writing the resolver in U4; mirror existing GraphQL patterns.
- Recipe argument JSON Schemas: define one or two carefully in U4; the remaining 10 follow the established convention.
- Whether `routine_asl_versions.step_manifest_json` should also be persisted as a typed column or kept entirely free-form JSON — decide during U3 GraphQL type authoring.

---

## Implementation Units

Units carried verbatim from the master plan. U-IDs are stable per the plan-stability rule.

- U1. **Step Functions Terraform module + IAM substrate**

**Goal:** Stand up the Step Functions execution substrate with a single tenant-ABAC-tagged execution role, log groups, S3 routine-output bucket, and alias-friendly resource conventions.

**Requirements:** R8, R11, R14 (substrate prereq for all)

**Dependencies:** None

**Files:**
- Create: `terraform/modules/app/routines-stepfunctions/main.tf`
- Create: `terraform/modules/app/routines-stepfunctions/variables.tf`
- Create: `terraform/modules/app/routines-stepfunctions/outputs.tf`
- Modify: `terraform/modules/app/main.tf` (wire the new module)
- Modify: `terraform/modules/thinkwork/main.tf` (pass-through stage variables)
- Modify: `terraform/modules/app/lambda-api/main.tf` (IAM `aws_iam_role_policy_attachment` lines for `states:StartExecution`/`SendTaskSuccess`/`SendTaskFailure`/`CreateStateMachine`/`UpdateStateMachine`/`PublishStateMachineVersion`/`CreateAlias`/`UpdateAlias`/`DeleteStateMachine`/`ValidateStateMachineDefinition`)

**Approach:**
- One execution role for all routines: trust `states.amazonaws.com`; inline policy includes `lambda:InvokeFunction` (scoped via tag condition), `bedrock-agentcore:StartCodeInterpreterSession` + `InvokeCodeInterpreter` + `StopCodeInterpreterSession`, `bedrock-agentcore:InvokeAgentRuntime`, `secretsmanager:GetSecretValue`, `states:StartExecution` + `DescribeExecution` + `StopExecution` + `SendTaskSuccess` + `SendTaskFailure` (for cross-routine `routine_invoke`), `s3:PutObject` + `GetObject` on the routine-output bucket scoped by tenant prefix.
- Tenant ABAC: principal-tag matched against resource-tag for `tenantId`.
- Log group `/aws/vendedlogs/states/thinkwork-${stage}-routines` retention 30d.
- S3 bucket `thinkwork-${stage}-routine-output` (private, no public access, default SSE).

**Patterns to follow:**
- `terraform/modules/app/agentcore-code-interpreter/main.tf`
- `terraform/modules/app/job-triggers/main.tf`

**Test scenarios:**
Test expectation: none — pure infrastructure. Verification is `terraform plan` + `thinkwork plan -s dev` showing the new module without errors.

**Verification:**
- `thinkwork plan -s dev` shows the new module's resources without referencing nonexistent IAM principals
- After `thinkwork deploy -s dev`, the role ARN, log group ARN, and bucket ARN are queryable via `terraform output`

---

- U2. **Schema additions: routine_executions, routine_step_events, routine_asl_versions, routine_approval_tokens**

**Goal:** Add Drizzle schema and migrations for the new run/step/version/token tables, plus the `engine` partition column on `routines`.

**Requirements:** R14, R15, R16, R17, R20

**Dependencies:** U1 (S3 bucket name available via terraform outputs for any default URI references — can be hardcoded with TODO and refactored)

**Files:**
- Create: `packages/database-pg/src/schema/routine-executions.ts`
- Create: `packages/database-pg/src/schema/routine-step-events.ts`
- Create: `packages/database-pg/src/schema/routine-asl-versions.ts`
- Create: `packages/database-pg/src/schema/routine-approval-tokens.ts`
- Modify: `packages/database-pg/src/schema/index.ts` (export new tables)
- Modify: `packages/database-pg/src/schema/routines.ts` (add `engine` text NOT NULL DEFAULT 'legacy_python' with CHECK in (`legacy_python`, `step_functions`); add `state_machine_arn` text NULL; add `state_machine_alias_arn` text NULL; add `documentation_md` text NULL; add `current_version` int NULL)
- Auto-generate: `packages/database-pg/drizzle/NNNN_routines_stepfunctions_substrate.sql` via `pnpm --filter @thinkwork/database-pg db:generate`

**Approach:**
- See master plan U2 for full column-by-column schema design.
- All `tenant_id` columns FK to `tenants.id`; indices on (tenant_id, status), (tenant_id, started_at) for hot queries.
- Partial UNIQUE on `routine_approval_tokens(execution_id, node_id) WHERE consumed=false`.
- If any hand-rolled SQL is needed (partial unique index), follow the `-- creates: public.X` header convention.

**Execution note:** After editing TS schema, run `pnpm --filter @thinkwork/database-pg db:generate`, inspect the auto-generated SQL for cleanliness, then `pnpm db:push -- --stage dev`.

**Patterns to follow:**
- `packages/database-pg/src/schema/scheduled-jobs.ts` (thread_turn_events high-volume shape)
- `packages/database-pg/src/schema/inbox-items.ts` (tenant-scoped + decision shape)

**Test scenarios:**
Test expectation: none for the schema itself. Verification is build + push succeeding without `db:migrate-manual` drift.

**Verification:**
- `pnpm --filter @thinkwork/database-pg build` clean
- `pnpm db:push -- --stage dev` succeeds
- `pnpm db:migrate-manual` reports no missing objects
- Existing routine rows on dev all have `engine = 'legacy_python'` after migration

---

- U3. **GraphQL schema: replace unbacked RoutineRun.steps + add RoutineExecution / RoutineStepEvent / RoutineAslVersion**

**Goal:** Update canonical GraphQL types and propagate codegen across all four consumer packages.

**Requirements:** R14, R15, R16, R17

**Dependencies:** U2

**Files:**
- Modify: `packages/database-pg/graphql/types/routines.graphql`
- Modify (regenerated): `apps/admin/src/gql/graphql.ts`, `apps/mobile/src/gql/graphql.ts` (verify path), `apps/cli/src/gql/graphql.ts` (verify path), `packages/api/src/gql/graphql.ts` (verify path), `terraform/schema.graphql`

**Approach:**
- Deprecate `RoutineRun` and `RoutineStep` types via `@deprecated` (don't remove yet; legacy resolvers still reference them; removal is Phase E U15).
- Add `Routine.engine`, `Routine.stateMachineArn`, `Routine.aliasArn`, `Routine.documentationMd`, `Routine.currentVersion`.
- Add new types: `RoutineExecution`, `RoutineStepEvent`, `RoutineAslVersion`.
- Add new queries: `routineExecutions`, `routineExecution`, `routineStepEvents`, `routineAslVersion`, `tenantToolInventory`.
- Add new mutations: `publishRoutineVersion` (replaces legacy update_routine code path), `decideRoutineApproval`.
- Add subscription: `OnRoutineExecutionUpdated`.

**Execution note:** After editing the .graphql file: `pnpm schema:build`, then `pnpm --filter @thinkwork/<pkg> codegen` for each of `apps/admin`, `apps/mobile`, `apps/cli`, `packages/api`.

**Patterns to follow:**
- `packages/database-pg/graphql/types/scheduled-jobs.graphql` (analogous execution + event types)

**Test scenarios:**
Test expectation: none — type-only change. Verification is `pnpm typecheck` passes across all consumers.

**Verification:**
- After codegen, all four consumers compile against the new schema
- New types and mutations appear in `apps/admin/src/gql/graphql.ts`

---

- U4. **Recipe catalog: v0 recipe definitions + tenantToolInventory resolver**

**Goal:** Define the v0 recipe set as a typed in-repo catalog (TS module — ThinkWork-eng-owned per R9), implement the `tenantToolInventory` resolver, and wire the recipe argument JSON Schemas the validator (U5) consumes.

**Requirements:** R6, R7, R9

**Dependencies:** U3 (codegen for `tenantToolInventory` consumers)

**Files:**
- Create: `packages/api/src/lib/routines/recipe-catalog.ts`
- Create: `packages/api/src/lib/routines/recipe-catalog.test.ts`
- Create: `packages/api/src/graphql/resolvers/routines/tenantToolInventory.query.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts` (wire new resolver)

**Approach:**
- `recipe-catalog.ts` exports a typed array of `{ id, displayName, description, argSchema (JSON Schema), aslEmitter (function), category, hitlCapable }` — 12 entries for the locked v0 set.
- `aslEmitter` returns the ASL state JSON for that recipe; uses JSONata for input/output queries.
- `tenantToolInventory` aggregates from `agents`, `tenant_mcp_servers.tools`, `tenant_mcp_context_tools`, `tenant_builtin_tools`, `tenant_skills`, and `routines` (only `engine = 'step_functions'` + visibility-permitted).
- Visibility: agent-stamped routines filter on owning agent unless promoted (per R21).

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/agents.query.ts`
- `packages/api/src/lib/derive-agent-skills.ts`

**Test scenarios:**
- Happy path: catalog exports 12 entries with non-empty argSchema and aslEmitter
- Happy path: each recipe's argSchema is a valid JSON Schema (Ajv assertion)
- Happy path: each recipe's aslEmitter returns valid ASL state shape (`Type`, `Resource` if Task, `Next` or `End`)
- Happy path: `tenantToolInventory` returns agents + tools + skills + prior step_functions routines for a tenant
- Edge case: tenant with zero agents returns empty `agents` array, not error
- Edge case: agent-stamped routine with `visibility: 'agent_private'` is omitted unless current actor is the owning agent

**Verification:**
- `pnpm --filter @thinkwork/api test recipe-catalog` passes
- `tenantToolInventory` query returns correct shape against dev tenant fixture

---

- U5. **routine-asl-validator Lambda + recipe-aware linter**

**Goal:** Server-side ASL validator combining `ValidateStateMachineDefinition` AWS API with a recipe-catalog linter (recipe-arg type check, Resource ARN catalog match, Choice rule field-existence check, cycle detection for `routine_invoke`).

**Requirements:** R10, R20

**Dependencies:** U4 (recipe catalog), U1 (Terraform IAM grants `states:ValidateStateMachineDefinition`)

**Files:**
- Create: `packages/lambda/routine-asl-validator.ts`
- Create: `packages/lambda/routine-asl-validator.test.ts`
- Modify: `scripts/build-lambdas.sh` (add `build_handler routine-asl-validator` entry)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (`for_each` entry)
- Modify: `terraform/modules/app/lambda-api/main.tf` (IAM `states:ValidateStateMachineDefinition`)

**Approach:**
- Bearer `API_AUTH_SECRET` service endpoint exposed via the existing handlers REST surface.
- Pipeline: (1) `ValidateStateMachineDefinition` AWS API; (2) Ajv arg-type check per Task state's recipe id; (3) Resource ARN catalog match; (4) Choice rule field validation via JSONata path resolution against prior-step output schema; (5) `routine_invoke` cycle detection via DAG walk.
- Returns `{ valid: bool, errors: ValidationError[], warnings: ValidationWarning[] }`. Errors are actionable in chat (state name + plain-language message); warnings (e.g., deprecated recipe) don't block publish.
- Snapshot env vars at handler entry.

**Execution note:** Test-first. The linter logic is the highest-value test target — LLM emissions are the primary failure mode. Land 6+ unit tests covering each error class before wiring to other phases.

**Patterns to follow:**
- `packages/api/src/handlers/sandbox-quota-check.ts`
- `packages/api/src/handlers/sandbox-invocation-log.ts`

**Test scenarios:**
- Happy path: valid ASL with all v0 recipes returns `{ valid: true }`
- Happy path: covers AE3 — invalid `Resource` ARN returns actionable error with the offending state name
- Edge case: empty `States` map returns `valid: false`
- Edge case: smallest legal routine (one `Pass` state with `End: true`) is valid
- Error path: invalid JSONata in InputPath/OutputPath returns parse error
- Error path: `python` step with non-string `code` arg returns Ajv arg-type error
- Error path: covers AE5 — `routine_invoke(B)` from routine A with cycle A→B→A returns "cycle detected" error
- Error path: `Choice` referencing unresolved field returns warning

**Verification:**
- `pnpm --filter @thinkwork/lambda test routine-asl-validator` passes all 8+ scenarios
- `terraform plan` shows the new Lambda + IAM grants
- After deploy, manual `curl -X POST /api/routines/validate` with sample ASL returns expected response

---

## System-Wide Impact

- **Interaction graph:** Phase A is purely additive — new Terraform module, new tables, new GraphQL types, new in-repo TS module, new Lambda. No existing flow is modified.
- **API surface parity:** GraphQL schema additions ripple through all consumers via codegen.
- **Unchanged invariants:** `thread_turns` flow untouched; `scheduled_jobs` schema unchanged; existing routine list/detail UI shows the same data; existing Python builder still uses legacy code path.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Drizzle migration drift between dev and CI | `pnpm db:migrate-manual` gate enforces; document migration steps in PR description |
| GraphQL codegen miss in one consumer breaks typecheck everywhere | Run `pnpm typecheck` across all four consumers before opening PR |
| New Lambda missing build entry blocks all deploys | Add to `scripts/build-lambdas.sh` AND `handlers.tf` in same commit (per institutional learning) |
| Stale tsbuildinfo in fresh worktree breaks api typecheck | Bootstrap: delete tsbuildinfo, build database-pg before typecheck (institutional learning) |
| Recipe argument schemas don't survive contact with real LLM emissions | Deferred — Phase C will exercise real LLM output and surface gaps |

---

## Sources & References

- **Master design plan:** `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- **Origin requirements:** `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`
- See master plan for the full Context & Research, institutional learnings, and external references.
