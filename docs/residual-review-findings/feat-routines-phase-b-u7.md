## Residual Review Findings

Source: ce-code-review autofix run `20260501-154106-69be8951` against `feat/routines-phase-b-u7` (base `a5bbec7a`).

Plan: `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` U7.

10 reviewers dispatched (correctness, testing, maintainability, project-standards, agent-native, learnings, reliability, security, adversarial, kieran-typescript, api-contract). 6 mechanical autofixes landed in the follow-up commit on this branch. The findings below remain — several P0s need their own focused PR because they cross package boundaries (schema → codegen → consumer apps).

### P0 — Schema-drift cluster

These are blocking for the publish flow to work end-to-end. They need a coordinated change to `packages/database-pg/graphql/types/routines.graphql` plus `pnpm --filter @thinkwork/<pkg> codegen` across `apps/admin`, `apps/mobile`, `apps/cli`, and `packages/api`.

- [P0][gated_auto → downstream-resolver][needs-verification] `packages/database-pg/graphql/types/routines.graphql:230-239` — **`CreateRoutineInput` has the legacy `type`/`schedule`/`config` shape but the new resolver expects `asl`/`markdownSummary`/`stepManifest`.** Every codegen-typed mobile/admin/CLI client will fail at `JSON.parse(undefined)`. Cross-reviewer agreement: correctness, api-contract, kieran-ts, testing.
  - Suggested fix: rewrite `CreateRoutineInput` to `{ tenantId: ID!, teamId: ID, agentId: ID, name: String!, description: String, asl: AWSJSON!, markdownSummary: String!, stepManifest: AWSJSON! }`. Run `pnpm schema:build` then codegen for each consumer. Verify all 4 codegen outputs compile.

- [P0][gated_auto → downstream-resolver][needs-verification] `packages/database-pg/graphql/types/routines.graphql:291` — **`triggerRoutineRun` declared to return `RoutineRun!` (deprecated legacy type) but the resolver returns a `routine_executions` row.** Clients selecting `steps`/`metadata`/`completedAt` null-propagate the entire mutation. Cross-reviewer agreement: correctness, api-contract, kieran-ts.
  - Suggested fix: change the schema return to `RoutineExecution!` (and accept an optional `input: AWSJSON` arg to match the resolver). Re-run codegen.

- [P1][manual → downstream-resolver] `packages/database-pg/graphql/types/routines.graphql:241-250` — **`UpdateRoutineInput` still accepts `type` and `config`; new resolver narrows them away silently.** Mobile's trigger-type radio sends `type` and silently no-ops. (correctness, api-contract)
  - Suggested fix: drop `type` and `config` from `UpdateRoutineInput`, OR keep them and have the resolver explicitly throw "use publishRoutineVersion for ASL changes" when present. Document the policy in the schema description.

### P0 — Auth gate broken for apikey callers

- [P0][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/{createRoutine,publishRoutineVersion,updateRoutine,triggerRoutineRun}.mutation.ts` — **`requireTenantAdmin` resolves apikey caller's `principalId` against `tenant_members`; service callers fail closed.** Phase C MCP wrappers can't call any of these mutations. (agent-native, with cross-reference to `authz.ts:192-224` `requireAdminOrApiKeyCaller`)
  - Suggested fix: swap `requireTenantAdmin(ctx, tenantId)` for `requireAdminOrApiKeyCaller(ctx, tenantId, "<op_name>")` on all 4 resolvers. Add operation names (`create_routine`, `publish_routine_version`, `trigger_routine_run`, `update_routine`) to the chat-builder agent's `agent_skills.permissions.operations` allowlist as part of Phase C U10/U11.

### P1 — Reliability + correctness

- [P1][gated_auto → downstream-resolver][needs-verification] `packages/api/src/graphql/resolvers/routines/createRoutine.mutation.ts:109` — **CreateStateMachine response ARN discarded.** Resolver computes the ARN locally via `stateMachineArn(...)` instead of using the response. If they diverge (e.g., regional ARN format change), subsequent calls fail. (reliability rel-6)
  - Suggested fix: capture `createResp.stateMachineArn` and use it on the Publish + CreateAlias calls.

- [P1][manual → downstream-resolver] `packages/lambda/job-trigger.ts:635` — **No `aws_lambda_function_event_invoke_config` for job-trigger.** EventBridge async retries default to 2; StartExecution lacks an idempotency `name`, so retries create duplicate SFN executions. Same pattern PR #552 fixed for skill-runs. (reliability rel-5, adversarial)
  - Suggested fix: add `aws_lambda_function_event_invoke_config { maximum_retry_attempts = 0 }` for job-trigger in `terraform/modules/app/lambda-api/handlers.tf`, route async failures to a DLQ. Or: pass a deterministic `name` to StartExecution derived from `triggerId + scheduleName`.

- [P1][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/createRoutine.mutation.ts:23` — **Drift reporter referenced in docstring does not exist.** Phase E was not implemented; orphan SFN resources from partial-failure mid-pipeline accumulate forever. (reliability rel-2, adversarial)
  - Suggested fix: defer to Phase E plan (`docs/plans/2026-05-01-008`) or build a minimal sweeper now that lists state machines tagged with `tenantId` not present in `routines` and deletes them.

- [P1][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/publishRoutineVersion.mutation.ts:118-128` — **UpdateAlias mid-chain failure leaves published-but-unaliased version + retry on PublishStateMachineVersion is not idempotent.** Operator clicks Publish, sees error, retries, second version is published, alias still on old. (reliability rel-3, adversarial)
  - Suggested fix: compose a single seam that retries the alias flip on transient failure; expose a manual "rollback" mutation that flips the alias back to `alias_was_pointing` (now properly captured per the autofix).

- [P1][gated_auto → downstream-resolver] `packages/api/src/graphql/resolvers/triggers/deleteRoutine.mutation.ts:7` — **`status='archived'` rows still fire StartExecution because job-trigger has no status check.** Composition gap with the scheduled_jobs surface. (adversarial)
  - Suggested fix: in job-trigger.ts, skip step_functions routines with `status='archived'`; or have deleteRoutine cancel the routine's scheduled_jobs in the same transaction.

### P2 — Coverage + maintainability

- [P2][manual → downstream-resolver] `packages/lambda/job-trigger.ts:579-663` — **The new step_functions branch has zero unit-test coverage.** Existing test file `packages/lambda/__tests__/job-trigger.skill-run.test.ts` doesn't cover the routine path. (testing T1)
  - Suggested fix: add `job-trigger.routine-fire.test.ts` with happy path + missing-alias skip + legacy_python fallthrough + missing-routine guard.

- [P2][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/updateRoutine.mutation.ts` — **No tests.** New 50-line resolver with admin gate + field-narrowing. (testing T3)
  - Suggested fix: add 3 tests — happy update, admin gate rejection, ASL-attempt-via-config rejection (depends on the schema policy decision above).

- [P2][gated_auto → downstream-resolver] `packages/api/src/graphql/resolvers/routines/publishRoutineVersion.mutation.ts:53-67` — **engine probe runs BEFORE requireTenantAdmin** — leaks routine engine state to non-admin callers. Asymmetric with createRoutine (gate-then-validate). (correctness)
  - Suggested fix: either (a) reorder to gate-first, or (b) accept the disclosure as a non-issue (caller already had the routineId, which is server-allocated and not enumerable). Add a comment explaining the choice.

- [P2][gated_auto → downstream-resolver] `packages/api/src/graphql/resolvers/triggers/{createRoutine,updateRoutine,triggerRoutineRun}.mutation.ts` — **Legacy resolver files remain on disk under `triggers/`** (un-exported). `any`-signed and skip requireTenantAdmin. Accidental re-import compiles. (maintainability M4, adversarial)
  - Suggested fix: delete the three files in this PR or the next. Add `throw new Error('legacy resolver — do not import')` at the top if deferral is required.

- [P2][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/{createRoutine,publishRoutineVersion}.mutation.ts` — **Validator errors collapsed into newline-joined string.** Agent gets a delimited blob instead of a structured `errors[]` array. (agent-native, kieran-ts)
  - Suggested fix: throw `GraphQLError` with `extensions: { code: "ASL_VALIDATION_FAILED", validationErrors: validation.errors, validationWarnings: validation.warnings }`. Yoga preserves `extensions` on the wire.

### P3 — Polish

- [P3][advisory → human] **No CHECK constraint pairing `engine='step_functions'` with non-null `state_machine_arn`** on the `routines` table. The 3 resolvers throw "invariant violation" if it occurs at runtime; a DB-level guard would prevent it. (adversarial)
  - Suggested fix: add a hand-rolled migration with `CHECK (engine = 'legacy_python' OR (state_machine_arn IS NOT NULL AND state_machine_alias_arn IS NOT NULL))`. Mark with `-- creates: ...` markers per the manual-migration drift reporter contract.

- [P3][advisory → human] **`triggerRoutineRun` has no debounce.** Double-click fires N concurrent SFN executions. (adversarial)
  - Suggested fix: rate-limit per `(tenant_id, routine_id)` at the resolver level, OR rely on application-level idempotency from a future "trigger lock" (deferred).

- [P3][advisory → human] **State-machine name length cap not validated at the resolver.** SFN limits to 80 chars. Current naming gives 58 chars, leaving 22-char headroom — fine for current stage names but worth a runtime assert. (security testing-gap)
  - Suggested fix: add a precondition check in `stateMachineName(stage, routineId)`.

### Pre-existing / not addressed in this PR

None.

### Coverage notes

- 10 reviewers dispatched; all 10 returned. No reviewer failures.
- 6 mechanical autofixes applied (snapshotRoutinesEnv hard-fails on missing required env, terraform wiring of `ROUTINES_EXECUTION_ROLE_ARN`/`ROUTINES_LOG_GROUP_ARN`/`AWS_ACCOUNT_ID`, `alias_was_pointing` semantic fix, `_setSfnClientForTests` removal, `void and/eq` escape-hatch removal, requestTimeout reduction).
- Validator drops: not run (autofix mode skips Stage 5b).
- Run artifact: `/tmp/compound-engineering/ce-code-review/20260501-154106-69be8951/`
