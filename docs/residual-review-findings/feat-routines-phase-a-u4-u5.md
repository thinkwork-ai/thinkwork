## Residual Review Findings

Source: ce-code-review autofix run `20260501-140620-063b50f0` against `feat/routines-phase-a-u4-u5` (base `feba4968`).

Plan: `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` U4 + U5.

8 autofixes applied + committed in `60295170`. The findings below are residual actionable work the autofix did not resolve. Each is tagged with severity, autofix_class, and the suggested fix shape.

### P1

- [P1][gated_auto → downstream-resolver][needs-verification] `packages/api/src/handlers/routine-asl-validator.ts:113` — **SFNClient has no explicit request timeout; 30s Lambda timeout is the only ceiling.** AWS-side hangs consume the full Lambda budget instead of falling through to the linter-only path within seconds.
  - Suggested fix: pass `requestHandler` with `requestTimeout: 5000` to the SFNClient constructor.
  - (reliability)

- [P1][manual → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.test.ts` — **Lambda handler boundary fully untested.** Bearer auth, OPTIONS preflight, 404 (wrong path), 405 (wrong method), and JSON-parse error paths have zero coverage; only the pure `validateRoutineAsl` core is tested.
  - Suggested fix: add a `describe("handler")` block that builds APIGatewayProxyEventV2 fixtures and asserts the response shape for each error case.
  - (testing)

### P2

- [P2][manual → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.ts:170-188` — **AWS `ValidateStateMachineDefinition` failure becomes a warning, not an error.** Publish flow checks `valid:true` and could ship ASL whose missing-Next / unreachable-state errors AWS would have caught. IAM rollout windows are a likely trigger.
  - Suggested fix: split policies — chat-builder tolerates the warning; publish flow surfaces a `strictMode` flag that converts `aws_validate_unavailable` into an error.
  - (reliability + adversarial — agree on the same fall-through)

- [P2][gated_auto → downstream-resolver] `packages/api/src/graphql/resolvers/routines/tenantToolInventory.query.ts:93-163` — **No LIMIT on any of the 5 selects.** A tenant with 1000+ agents/MCP-tools/skills returns the full set in one shot.
  - Suggested fix: add `.limit(500)` on each select; document the cap in the resolver header. (4 enterprises × 100+ agents × 5 templates makes this a real hot path.)
  - (reliability)

- [P2][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/tenantToolInventory.query.ts:93-163` — **`Promise.all` rejects entire inventory if any single query fails.** No partial-result mode.
  - Suggested fix: switch to `Promise.allSettled`; surface a warnings array on the GraphQL output (requires schema change).
  - (reliability)

- [P2][manual → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.ts:560-578` — **Cycle DFS lets caller-supplied callGraph drive O(K·(N+E)) work** with no upper bound enforced at the handler.
  - Suggested fix: cap `callGraph` entries (e.g., 1000); reject oversized payloads before DFS.
  - (security)

- [P2][manual → downstream-resolver] `packages/api/src/graphql/resolvers/routines/tenantToolInventory.query.ts:225-231` — **Agent-private routines unconditionally excluded.** `.filter((r) => r.agent_id === null)` cuts the agent's own routines out for every caller, including the agent that owns them. The chat builder's `routine_invoke` recipe can't discover agent-owned routines.
  - Suggested fix: when `auth.agentId` is set (apikey caller via `x-agent-id`), admit `agent_id == auth.agentId` rows in addition to NULL. Defer until the visibility column lands or implement now if Phase B's chat-builder integration depends on it.
  - (agent-native)

- [P2][gated_auto → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.ts:271` — **Comment marker silently trusted over Resource ARN.** A state with `Comment: recipe:slack_send` and `Resource: arn:aws:states:::http:invoke` runs slack_send schema check; ARN/marker mismatch never surfaces.
  - Suggested fix: when marker resolves to recipe X but ARN doesn't match `X.resourceArnPattern`, emit a `recipe_marker_arn_mismatch` error.
  - (adversarial)

### P3

- [P3][advisory → human] `packages/api/src/handlers/routine-asl-validator.ts` — **Validator response missing catalog version.** Phase B is going to add new recipes; agents caching old descriptions could emit ASL the validator rejects with errors referencing fields the agent thinks shouldn't exist.
  - Suggested fix: include `catalogVersion` (hash or semver) in `{valid, errors, warnings}` response. Cheap to add now, expensive to retrofit once consumers exist.
  - (agent-native)

- [P3][gated_auto → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.ts:548` — **Validator ignores `event.isBase64Encoded`** when parsing the body.
  - Suggested fix: decode base64 body when `isBase64Encoded`; mirror `mcp-oauth.ts`/`stripe-checkout.ts` patterns.
  - (security)

- [P3][gated_auto → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.ts:549` — **No body-size guard before `JSON.parse`.** O(states²) stringify in the choice-rule linter is bounded only by Lambda memory.
  - Suggested fix: add a Content-Length / body.length cap (~256KB matches Step Functions state-payload limit).
  - (reliability)

- [P3][gated_auto → downstream-resolver] `packages/api/src/lib/routines/recipe-catalog.ts:152-178` — **`findRecipeByArn` first-match-wins on shared `arn:aws:states:::lambda:invoke`** (used by tool_invoke / slack_send / email_send / python). Silent misclassification when the Comment marker is absent.
  - Suggested fix: either require Comment marker for any Task with shared-ARN recipes (emit `comment_marker_required` error) or drop `findRecipeByArn` entirely and make markers mandatory.
  - (maintainability + adversarial)

- [P3][manual → downstream-resolver] `packages/api/src/handlers/routine-asl-validator.test.ts` — **Recipe-arg reconstruction only tested for `python` and (now) `routine_invoke`.** `tool_invoke`, `set_variable`, and the MCP `inputSchema` fallback in `tenantToolInventory` paths are untested.
  - Suggested fix: add reverse-mapping tests for tool_invoke (Payload.tool/source/args) and set_variable (Result single-key) plus a tenantToolInventory test that asserts MCP `inputSchema` flows through to `argSchemaJson`.
  - (testing)

- [P3][manual → downstream-resolver] `packages/api/src/__tests__/tenant-tool-inventory.test.ts` — **Tests mock the entire DB.** Every Drizzle filter (`status != archived`, `enabled = true`, `engine = step_functions`, `status = active`, the new `status = approved`) is invisible to the tests; a regression that drops one would be silent.
  - Suggested fix: either move to a real Drizzle test harness OR assert on the filter SQL via spy/mock-call inspection.
  - (testing)

### Pre-existing / not addressed in this PR

None.

### Coverage notes

- 10 reviewers dispatched; all 10 returned. No reviewer failures.
- Mode-aware demotions / suppressions: ~7 P3 advisories from kieran-typescript and maintainability rolled into the residual list above.
- Validator drops: not run (autofix mode skips Stage 5b).
- Run artifact: `/tmp/compound-engineering/ce-code-review/20260501-140620-063b50f0/`
