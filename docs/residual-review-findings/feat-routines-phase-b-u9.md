# Residual Review Findings — feat/routines-phase-b-u9

**Plan**: docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md (U9)
**Branch**: feat/routines-phase-b-u9
**Review**: 12-reviewer parallel autofix pass (correctness, testing, maintainability, project-standards, agent-native, learnings, security, reliability, data-migrations, adversarial, api-contract, kieran-typescript)

The autofix pass deduplicated the `TERMINAL_STATUSES` SQL/TS list (commit `fix(review): deduplicate terminal-status list in routine-execution-callback`). The items below remain as `downstream-resolver` follow-ups.

## Residual findings

- **P2 [reliability] fetch lacks AbortController timeout** — `packages/lambda/routine-step-callback-client.ts:55` invokes `fetch(url, ...)` with no abort signal. A stalled API endpoint could hold the SFN Task wrapper open consuming Lambda budget. Suggested fix: wrap with `AbortSignal.timeout(5000)`; treat AbortError as a non-fatal POST failure on the same fire-and-log path as transport errors. `autofix_class: gated_auto` because adding the abort path is a behavior change worth a deliberate review.

- **P2 [maintainability] hardcoded SFN ARN prefix in EventBridge filter** — `terraform/modules/app/routines-stepfunctions/main.tf` filters on `arn:aws:states:${var.region}:${var.account_id}:stateMachine:thinkwork-${var.stage}-routine-` as a literal prefix string. If Phase B U7's createRoutine resolver ever changes the state-machine naming convention (e.g., adds a tenant id), the EventBridge rule silently misses events. The prefix should be exposed by `lambda-api/handlers.tf` (where the resolver runs) or by a new shared local in `terraform/modules/thinkwork/main.tf`, then consumed here.

- **P3 [testing] idempotency contract is integration-tested only** — the plan's "Land tests covering happy path + idempotency for both endpoints" is partially met: 30 shape-validation tests pass, but the ON CONFLICT DO NOTHING (step-callback) and conditional UPDATE terminal-lock (execution-callback) claims are exercised only when a real Postgres is in the loop. Add mocked-DB tests that assert (a) `onConflictDoNothing` was called with the expected `{target, where}` for step-callback, and (b) the conditional UPDATE's WHERE clause includes the terminal-status guard for execution-callback.

- **P3 [testing] cross-tenant guard not directly tested** — `packages/api/src/handlers/routine-step-callback.ts:120` returns 403 when `execution.tenant_id !== shaped.tenant_id`. This is a security control worth a regression test. Mock the routine_executions select to return a foreign-tenant row; assert the handler returns 403 and the insert isn't called.

- **P3 [testing] dual-mode handler dispatch branch is not unit-tested end-to-end** — `eventBridgeToBody()` translation has 4 unit tests, but the `handler()` dispatch path that detects `source === "aws.states"` and routes through the EventBridge body adapter isn't covered locally. Plan's integration-test backstop ("real SFN execution piped through EventBridge populates routine_step_events for an agent_invoke-only routine") closes the loop end-to-end; a unit-level dispatch test would catch the translation hand-off in isolation.

## Advisory

- **[learnings] hand-rolled migration with `-- creates:` markers** — 0056 follows the project's pattern (`docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`). Worth verifying the deploy.yml drift reporter picks it up post-merge.

- **[security] Bearer secret rotation** — The handler accepts the same `API_AUTH_SECRET` used by sandbox-quota-check / sandbox-invocation-log. Rotation rotates all of them simultaneously (per `project_api_auth_secret_rotated`). No new key surface introduced — this is a benefit of the shared secret pattern, not a finding.
