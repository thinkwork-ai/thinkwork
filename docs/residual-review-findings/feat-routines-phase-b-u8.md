# Residual Review Findings — feat/routines-phase-b-u8

**Plan**: docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md (U8)
**Branch**: feat/routines-phase-b-u8
**Review pass**: 10-reviewer parallel (correctness, testing, maintainability, project-standards, agent-native, learnings, security, adversarial, kieran-typescript, reliability)

P0/P1 findings were addressed in commit `fix(review): apply autofix feedback for U8` (cross-tenant IDOR gate, decisionValues schema field, transaction wrapper, fail-loud env, Lambda zero-retry config, FunctionError surfacing). The findings below remain as residual `downstream-resolver` work.

## Residual findings

- **P2 [testing] callback handler boundaries untested** — `packages/api/src/handlers/routine-approval-callback.ts:56` has no direct unit tests. The retry helper, transaction-rollback path, cross-tenant assignee drop, and "executionId never resolves" failure mode are exercised only transitively via integration. Recommend a focused suite under `packages/api/src/__tests__/routine-approval-callback.test.ts` covering: (a) row resolves on first try, (b) row resolves on third retry, (c) all retries miss → throws, (d) assigneeUserId from foreign tenant → recipient_id=null + warn, (e) tx.insert(routineApprovalTokens) throws → no orphaned inbox row.

- **P2 [testing] dispatch-into-bridge untested** — `packages/api/src/graphql/resolvers/inbox/{decideInboxItem,approveInboxItem,rejectInboxItem}.mutation.ts` now call `bridgeInboxDecisionToRoutineApproval` for `routine_approval` items but the resolver tests don't assert that dispatch happens. `routine-approval-bridge.test.ts` covers the bridge in isolation; resolver-level tests should assert the bridge is invoked (with the correct decision/payload) for routine_approval items and is skipped for non-routine items. Without this, a future refactor could silently drop the dispatch.

- **P2 [reliability] no rollback verification test** — The `db.transaction()` wrapper around the two inserts in routine-approval-callback is correct by inspection, but there's no test that proves a `routineApprovalTokens.insert` failure leaves zero rows in `inbox_items`. Add a test that simulates the second-insert failure and asserts `inbox_items` row count is unchanged. This is the single most load-bearing invariant of the callback handler — worth a regression test.

- **P3 [testing] env-test-leakage** — `routines-publish-flow.test.ts` `beforeEach` now sets `ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME` but never `delete`s it in `afterEach`. The same is true for the other env vars set there. Not currently causing failures, but a different test file that intentionally tests the unset case would inherit this stub and pass spuriously. Consider adding `afterEach(() => { delete process.env.ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME; ... })`.

- **P3 [maintainability] resolveRoutineExecutionWithRetry magic numbers** — The `3` attempts × `100ms` delay constants in `resolveRoutineExecutionWithRetry` are inline numbers. Either pull them to module-level `const` with a comment explaining the choice (chosen because the resolver insert is sub-100ms in practice), or accept them as acceptable inline magic for a function that's two lines tall. P3 because the function is small and the comment in the body already explains the choice.

- **P3 [reliability] inbox row description vs config duplication** — The callback writes `markdownContext` to both `inbox_items.description` and `inbox_items.config.markdownContext`. The duplication is intentional (description is rendered by the inbox UI; config is the canonical recipe payload) but worth a one-line comment in the code so a future cleanup pass doesn't dedupe to `description`-only and break the config-payload contract.

- **P3 [agent-native] no agent-callable trigger for routine_approval inbox view** — Operators decide routine approvals through the inbox UI, but there's no GraphQL query an agent could use to introspect pending routine_approval items in its own tenant. Out of scope for U8 (the plan U21 retires legacy mutations and is the natural carrier for inbox-introspection queries) but worth tracking.

## Advisory

- **[learnings] consider adding a docs/solutions entry** for the consume-once + partial-UNIQUE-index pattern. This is the third place in the codebase using it (memory-deduplication, scheduled_jobs idempotency, now routine-approval-tokens) and a one-page solution doc would help future authors find the pattern by name rather than rediscovering it.

- **[security] tenant tag enforcement deferred** — The plan calls for SFN state machines to carry tenant ABAC tags. U7 wired the tags on creation (publishRoutineVersion); U8 didn't add a verification step that the routine_approval_callback's `execution.tenant_id` matches the SFN execution's tenant tag. This is defense-in-depth — the IAM trust boundary on the callback Lambda already enforces the boundary — but a future hardening PR could read the tag via `DescribeStateMachine` and assert.
